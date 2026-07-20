"""Optional OAuth / SSO login for Google and Microsoft.

Providers are enabled purely by configuration: set a provider's CLIENT_ID and
CLIENT_SECRET and it lights up. `GET /auth/oauth/providers` reports which are on,
so the login screen shows only the configured buttons. Authorization-code flow:

  GET /auth/oauth/{provider}/login     -> redirect to the provider
  GET /auth/oauth/{provider}/callback  -> exchange code, find-or-create user,
                                          issue our JWT, redirect back to the app

OAuth users are matched/created by email and given the 'member' role. They have
no usable password (a random hash is stored); they sign in via the provider.
"""
import os
import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from . import db, security

router = APIRouter(prefix="/auth/oauth", tags=["auth"])

# Public base URL the provider redirects back to (no trailing slash). The
# callback is {base}/api/auth/oauth/{provider}/callback — register that exact URL
# in the Google / Microsoft app console.
REDIRECT_BASE_URL = os.environ.get("OAUTH_REDIRECT_BASE_URL", "http://localhost:8000").rstrip("/")
# Where to send the browser after success — an SPA route that reads the token
# from the URL fragment and stores it (see the OAuthCallback page).
POST_LOGIN_URL = os.environ.get("OAUTH_POST_LOGIN_URL", "/auth/callback")

_STATE_COOKIE = "oauth_state"
_DISPLAY_NAMES = {"google": "Google", "microsoft": "Microsoft"}


def _provider_config() -> dict[str, dict]:
    """Build config for every provider that has both id + secret set."""
    cfg: dict[str, dict] = {}

    g_id = os.environ.get("GOOGLE_CLIENT_ID")
    g_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if g_id and g_secret:
        cfg["google"] = {
            "client_id": g_id,
            "client_secret": g_secret,
            "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
            "token": "https://oauth2.googleapis.com/token",
            "userinfo": "https://openidconnect.googleapis.com/v1/userinfo",
            "scope": "openid email profile",
        }

    m_id = os.environ.get("MICROSOFT_CLIENT_ID")
    m_secret = os.environ.get("MICROSOFT_CLIENT_SECRET")
    m_tenant = os.environ.get("MICROSOFT_TENANT_ID", "common")
    if m_id and m_secret:
        cfg["microsoft"] = {
            "client_id": m_id,
            "client_secret": m_secret,
            "authorize": f"https://login.microsoftonline.com/{m_tenant}/oauth2/v2.0/authorize",
            "token": f"https://login.microsoftonline.com/{m_tenant}/oauth2/v2.0/token",
            "userinfo": "https://graph.microsoft.com/oidc/userinfo",
            "scope": "openid email profile",
        }

    return cfg


def _redirect_uri(provider: str) -> str:
    return f"{REDIRECT_BASE_URL}/api/auth/oauth/{provider}/callback"


async def _find_or_create_user(email: str, name: str, surname: str) -> int:
    """Match an existing user by email, or create one (member role, no password)."""
    pool = db.get_pool()
    row = await pool.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if row:
        # SSO proves email ownership, which is what a pending invitation was
        # waiting for — activate. (Inactive users stay inactive: admin decision.)
        await pool.execute(
            "UPDATE users SET status = 'active', invite_token = NULL "
            "WHERE id = $1 AND status = 'pending'",
            row["id"],
        )
        return row["id"]
    # OAuth users authenticate via the provider — store a random, unusable hash.
    unusable = security.hash_password(secrets.token_urlsafe(32))
    role_id = await pool.fetchval("SELECT id FROM roles WHERE name = 'member'")
    created = await pool.fetchrow(
        "INSERT INTO users (name, surname, email, password_hash, role_id) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        name,
        surname,
        email,
        unusable,
        role_id,
    )
    return created["id"]


@router.get("/providers")
async def list_providers() -> list[dict]:
    """Public: which SSO providers are configured (drives the login buttons)."""
    return [{"id": p, "name": _DISPLAY_NAMES.get(p, p.title())} for p in _provider_config()]


@router.get("/{provider}/login")
async def oauth_login(provider: str) -> RedirectResponse:
    cfg = _provider_config().get(provider)
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not enabled")

    state = secrets.token_urlsafe(24)
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "scope": cfg["scope"],
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{cfg['authorize']}?{urllib.parse.urlencode(params)}")
    # CSRF: remember the state in a short-lived cookie, verified on callback.
    resp.set_cookie(_STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax")
    return resp


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    cfg = _provider_config().get(provider)
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not enabled")
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing authorization code")

    expected = request.cookies.get(_STATE_COOKIE)
    if not state or not expected or not secrets.compare_digest(state, expected):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid OAuth state")

    async with httpx.AsyncClient(timeout=15) as client:
        token_res = await client.post(
            cfg["token"],
            data={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": _redirect_uri(provider),
            },
            headers={"Accept": "application/json"},
        )
        if token_res.status_code != 200:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Token exchange failed")
        provider_token = token_res.json().get("access_token")
        if not provider_token:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No access token from provider")

        info_res = await client.get(
            cfg["userinfo"], headers={"Authorization": f"Bearer {provider_token}"}
        )
        userinfo = info_res.json()

    email = userinfo.get("email")
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provider did not return an email")
    name = userinfo.get("given_name") or userinfo.get("name") or email.split("@")[0]
    surname = userinfo.get("family_name") or ""

    user_id = await _find_or_create_user(email, name, surname)
    app_token = security.create_access_token(str(user_id))

    # Send the token back via the URL fragment (not logged by servers/proxies).
    base = POST_LOGIN_URL if POST_LOGIN_URL.startswith("http") else f"{REDIRECT_BASE_URL}{POST_LOGIN_URL}"
    resp = RedirectResponse(f"{base}#token={urllib.parse.quote(app_token)}")
    resp.delete_cookie(_STATE_COOKIE)
    return resp
