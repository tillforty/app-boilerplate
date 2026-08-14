"""First-run n8n provisioning — run inside the api container:

    docker compose exec -T api python /tmp/tf_n8n_provision.py

Idempotently creates the n8n owner account and a read-only public-API key, then
prints a machine-parseable block that start.sh writes back into .env
(N8N_API_KEY / N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD). Re-running is safe: when
the owner already exists it signs in instead of failing. start.sh only calls it
while N8N_API_KEY is empty, so Settings › Operations lists executions from the
first ./start.sh with n8n enabled, with nothing to click.

Config via env (passed with `docker compose exec -e ...`):
  N8N_INTERNAL_URL   where n8n answers on the compose network (default http://n8n:5678)
  N8N_OWNER_EMAIL    owner account to create/sign in as (required)
  N8N_OWNER_PASSWORD its password (required; n8n wants 8+ chars, a digit and a capital)
  N8N_API_KEY_LABEL  label for the generated key (default 'Tillforty Operations')

Runs from the api container because it already has httpx and sits on the same
network as n8n — the published host port is not needed and may be firewalled.
"""
import json
import os
import sys
import time

import httpx

BASE = (os.environ.get("N8N_INTERNAL_URL") or "http://n8n:5678").rstrip("/")
EMAIL = os.environ.get("N8N_OWNER_EMAIL") or ""
PASSWORD = os.environ.get("N8N_OWNER_PASSWORD") or ""
LABEL = os.environ.get("N8N_API_KEY_LABEL") or "Tillforty Operations"

# Least privilege: enough for the Operations execution feed, nothing more.
WANTED_SCOPES = ["execution:read", "execution:list", "workflow:read", "workflow:list"]

# n8n refuses cookie-auth requests without a browser id on some builds.
HEADERS = {"browser-id": "tillforty-provisioner", "Content-Type": "application/json"}

# The session cookie is carried by hand rather than by httpx's cookie jar: n8n
# marks it Secure for any host that isn't localhost (N8N_SECURE_COOKIE), and a
# well-behaved client drops a Secure cookie received over plain http — which is
# exactly how the api container reaches n8n inside the compose network.
AUTH: dict = {}


def _capture_auth(resp: httpx.Response) -> None:
    for cookie in resp.headers.get_list("set-cookie"):
        if cookie.startswith("n8n-auth="):
            AUTH["Cookie"] = cookie.split(";", 1)[0]


def _headers() -> dict:
    return {**HEADERS, **AUTH}


def fail(msg: str) -> None:
    print(f"provisioning skipped: {msg}", file=sys.stderr)
    raise SystemExit(1)


def wait_for_settings(client: httpx.Client, attempts: int = 60) -> dict:
    """n8n answers /rest/settings only after its migrations finish — on a first
    boot that is a couple of minutes."""
    for _ in range(attempts):
        try:
            resp = client.get(f"{BASE}/rest/settings", timeout=10.0)
            if resp.status_code == 200:
                return resp.json().get("data") or {}
        except httpx.HTTPError:
            pass
        time.sleep(5)
    fail("n8n never became ready")
    return {}


def sign_in(client: httpx.Client) -> None:
    """Sign in as the owner. The login body key was renamed across versions, so
    both spellings are tried before giving up."""
    for body in ({"emailOrLdapLoginId": EMAIL, "password": PASSWORD}, {"email": EMAIL, "password": PASSWORD}):
        resp = client.post(f"{BASE}/rest/login", json=body, headers=_headers(), timeout=20.0)
        if resp.status_code < 300:
            _capture_auth(resp)
            return
    fail("could not sign in to n8n with N8N_OWNER_EMAIL/N8N_OWNER_PASSWORD")


def create_owner(client: httpx.Client) -> None:
    resp = client.post(
        f"{BASE}/rest/owner/setup",
        json={
            "email": EMAIL,
            "firstName": "Tillforty",
            "lastName": "Admin",
            "password": PASSWORD,
        },
        headers=_headers(),
        timeout=30.0,
    )
    if resp.status_code >= 300:
        fail(f"owner setup returned {resp.status_code}")
    _capture_auth(resp)


def existing_key_labels(client: httpx.Client) -> set:
    resp = client.get(f"{BASE}/rest/api-keys", headers=_headers(), timeout=20.0)
    if resp.status_code >= 300:
        return set()
    data = resp.json().get("data") or {}
    items = data.get("items") if isinstance(data, dict) else data
    return {i.get("label") for i in (items or [])}


def supported_scopes(client: httpx.Client) -> list:
    """Intersect the wanted scopes with what this n8n build knows about; older
    builds don't take a scopes field at all, in which case send none."""
    resp = client.get(f"{BASE}/rest/api-keys/scopes", headers=_headers(), timeout=20.0)
    if resp.status_code >= 300:
        return []
    available = set(resp.json().get("data") or [])
    return [s for s in WANTED_SCOPES if s in available]


def create_key(client: httpx.Client) -> str:
    body = {"label": LABEL, "expiresAt": None}
    scopes = supported_scopes(client)
    if scopes:
        body["scopes"] = scopes
    resp = client.post(f"{BASE}/rest/api-keys", json=body, headers=_headers(), timeout=30.0)
    if resp.status_code >= 300:
        fail(f"API key creation returned {resp.status_code}")
    data = resp.json().get("data") or {}
    # `rawApiKey` is the only time the full key is returned; older builds put it
    # in `apiKey` instead.
    key = data.get("rawApiKey") or data.get("apiKey") or ""
    if not key or key.startswith("*"):
        fail("n8n did not return a usable API key")
    return key


def main() -> None:
    if not EMAIL or not PASSWORD:
        fail("N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD are required")

    with httpx.Client(follow_redirects=True) as client:
        settings = wait_for_settings(client)
        needs_setup = bool((settings.get("userManagement") or {}).get("showSetupOnFirstLoad"))
        if needs_setup:
            create_owner(client)
        else:
            sign_in(client)

        if LABEL in existing_key_labels(client):
            # The key value is only shown at creation time, so a same-label key
            # from a previous run can't be recovered — make a fresh one and let
            # the operator delete the stale entry in the n8n UI if they care.
            print(f"note: an API key labelled {LABEL!r} already exists", file=sys.stderr)
        key = create_key(client)

    print("__TF_N8N__")
    print(f"API_KEY={key}")
    print(f"OWNER_EMAIL={EMAIL}")
    print(f"OWNER_CREATED={'true' if needs_setup else 'false'}")


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPError as exc:  # network trouble is not fatal to ./start.sh
        fail(f"could not reach n8n at {BASE}: {exc}")
    except json.JSONDecodeError as exc:
        fail(f"unexpected response from n8n: {exc}")
