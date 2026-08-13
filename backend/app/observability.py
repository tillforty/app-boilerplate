"""Error monitoring via the Sentry SDK → self-hosted GlitchTip.

GlitchTip speaks the Sentry DSN + REST API, so the standard `sentry-sdk` points
straight at it. Everything here is env-driven and best-effort:

  SENTRY_DSN          where the backend sends errors. BLANK = disabled (no-op),
                      exactly like the n8n helpers. Server-side can use the
                      internal host, e.g. http://glitchtip:8080/<project>.
  SENTRY_ENVIRONMENT  tag attached to every event (production/staging/dev).
  SENTRY_RELEASE      optional release identifier (e.g. a git SHA).

Enable the bundled GlitchTip with `GLITCHTIP_ENABLED=true` (see docker-compose /
start.sh); then create a project in its UI and paste the DSN into SENTRY_DSN.
"""
import logging
import os

logger = logging.getLogger(__name__)

SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
SENTRY_ENVIRONMENT = os.environ.get("SENTRY_ENVIRONMENT", "production").strip() or "production"
SENTRY_RELEASE = os.environ.get("SENTRY_RELEASE", "").strip()

# Where a human browses captured errors. Prefer the bundled GlitchTip's public
# URL; fall back to an explicit Sentry API/UI URL if one is configured.
_GLITCHTIP_ENABLED = os.environ.get("GLITCHTIP_ENABLED", "false").strip().lower() == "true"
_GLITCHTIP_DOMAIN = os.environ.get("GLITCHTIP_DOMAIN", "").strip().rstrip("/")
_SENTRY_API_URL = os.environ.get("SENTRY_API_URL", "").strip().rstrip("/")

# ── Reading issues back via the Sentry-compatible REST API ───────────────────
# The backend (not the browser) calls this, so the base URL must be reachable
# from inside the api container: an explicit SENTRY_API_URL wins, else the
# bundled GlitchTip's internal service address (NOT GLITCHTIP_DOMAIN, which is
# the browser-facing localhost/public URL). A token + org + project slug are
# required to list issues.
SENTRY_API_TOKEN = os.environ.get("SENTRY_API_TOKEN", "").strip()
SENTRY_ORG_SLUG = os.environ.get("SENTRY_ORG_SLUG", "").strip()
SENTRY_PROJECT_SLUG = os.environ.get("SENTRY_PROJECT_SLUG", "").strip()


def is_configured() -> bool:
    """True when a DSN is set, i.e. the backend will actually send events."""
    return bool(SENTRY_DSN)


def ui_url() -> str | None:
    """Best-effort URL of the error-browsing UI (the bundled GlitchTip, or an
    explicitly configured Sentry). None when nothing is known."""
    if _GLITCHTIP_ENABLED and _GLITCHTIP_DOMAIN:
        return _GLITCHTIP_DOMAIN
    return _SENTRY_API_URL or None


def init_sentry() -> None:
    """Initialize the Sentry SDK. No-op (and logs why) when SENTRY_DSN is blank,
    so the app runs identically with error capture off. Never raises: a broken
    monitoring config must not take the API down."""
    if not SENTRY_DSN:
        logger.info("SENTRY_DSN not set — error monitoring disabled.")
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=SENTRY_ENVIRONMENT,
            release=SENTRY_RELEASE or None,
            # Errors only by default — no performance sampling (keep it light and
            # avoid shipping request volume to a small self-hosted instance).
            traces_sample_rate=0.0,
            # Don't attach PII (user IPs, cookies, request bodies) unless you
            # explicitly opt in — this is a boilerplate default.
            send_default_pii=False,
        )
        logger.info(
            "Sentry error monitoring initialized (environment=%s).", SENTRY_ENVIRONMENT
        )
    except Exception:  # noqa: BLE001 - monitoring must never break startup
        logger.warning("Failed to initialize Sentry SDK; continuing without it.", exc_info=True)


def status() -> dict:
    """Small status payload for the admin Settings 'Error Monitoring' card."""
    return {
        "capture_configured": is_configured(),
        "bundled_glitchtip_enabled": _GLITCHTIP_ENABLED,
        "environment": SENTRY_ENVIRONMENT,
        "ui_url": ui_url(),
    }


def _api_base() -> str | None:
    """Base URL the backend uses to READ issues. Explicit SENTRY_API_URL wins;
    otherwise the bundled GlitchTip's internal address when it's enabled."""
    if _SENTRY_API_URL:
        return _SENTRY_API_URL
    if _GLITCHTIP_ENABLED:
        return "http://glitchtip:8080"
    return None


def api_configured() -> bool:
    """True when the backend has everything needed to list issues."""
    return bool(_api_base() and SENTRY_API_TOKEN and SENTRY_ORG_SLUG and SENTRY_PROJECT_SLUG)


def setup_status() -> dict:
    """Per-requirement flags for the Development › Issues setup checklist. Each
    boolean maps to one checklist step in the UI; no secrets are returned."""
    return {
        "glitchtip_enabled": _GLITCHTIP_ENABLED,
        "capture_configured": is_configured(),
        "api_token_configured": bool(SENTRY_API_TOKEN),
        "org_slug_configured": bool(SENTRY_ORG_SLUG),
        "project_slug_configured": bool(SENTRY_PROJECT_SLUG),
        "api_configured": api_configured(),
        "environment": SENTRY_ENVIRONMENT,
        "ui_url": ui_url(),
    }


def _issue_web_url(issue_id: str, permalink: str | None) -> str | None:
    """Best-effort browser link to an issue in the GlitchTip UI. Prefer a public
    UI URL we control (permalink can point at an internal host)."""
    base = ui_url()
    if base and SENTRY_ORG_SLUG:
        return f"{base}/{SENTRY_ORG_SLUG}/issues/{issue_id}"
    return permalink


def _frames(event: dict) -> tuple[str | None, str | None, list[dict]]:
    """Exception type, message and stack frames from an event's `entries`.

    GlitchTip mirrors Sentry's shape: entries[] carries an `exception` entry
    whose values[] each hold a stacktrace. Take the last value — the exception
    that was raised rather than whatever it was raised *from* — and normalize to
    snake_case. `vars` is dropped deliberately: frame locals are exactly where
    secrets turn up in a traceback.
    """
    entry = next((e for e in event.get("entries") or [] if e.get("type") == "exception"), None)
    values = ((entry or {}).get("data") or {}).get("values") or []
    if not values:
        return None, None, []
    value = values[-1]
    frames = []
    for f in (value.get("stacktrace") or {}).get("frames") or []:
        frames.append(
            {
                "filename": f.get("filename") or f.get("absPath"),
                "function": f.get("function"),
                "module": f.get("module"),
                "line_no": f.get("lineNo"),
                "in_app": bool(f.get("inApp")),
                # `context` is a list of [lineNo, text] pairs around the frame.
                "context": [
                    {"line_no": c[0], "text": str(c[1])}
                    for c in (f.get("context") or [])
                    if isinstance(c, (list, tuple)) and len(c) >= 2
                ],
            }
        )
    return value.get("type"), value.get("value"), frames


async def fetch_issue(issue_id: str) -> dict:
    """One issue plus its latest event, so the app can show a stack trace without
    sending anyone to the tracker's own UI — and its own separate login.

    Same contract as fetch_issues: RuntimeError when unconfigured, httpx errors
    propagate to the router.
    """
    if not api_configured():
        raise RuntimeError("Issue API is not configured (token/org/project slug missing).")

    import httpx

    base = _api_base()
    headers = {"Authorization": f"Bearer {SENTRY_API_TOKEN}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{base}/api/0/issues/{issue_id}/", headers=headers)
        resp.raise_for_status()
        issue = resp.json()
        # The latest event is a second fetch and may legitimately be missing
        # (retention, or an issue with no stored event); that isn't an error.
        event: dict = {}
        try:
            ev = await client.get(
                f"{base}/api/0/issues/{issue_id}/events/latest/", headers=headers
            )
            if ev.status_code == 200:
                event = ev.json()
        except httpx.HTTPError:
            event = {}

    exc_type, exc_value, frames = _frames(event)
    meta = issue.get("metadata") or {}
    issue_id_str = str(issue.get("id", issue_id))
    return {
        "id": issue_id_str,
        "short_id": issue.get("shortId"),
        "title": issue.get("title") or issue.get("culprit") or "(untitled)",
        "culprit": issue.get("culprit"),
        "level": issue.get("level"),
        "status": issue.get("status"),
        "count": int(issue.get("count") or 0),
        "user_count": int(issue.get("userCount") or 0),
        "first_seen": issue.get("firstSeen"),
        "last_seen": issue.get("lastSeen"),
        "web_url": _issue_web_url(issue_id_str, issue.get("permalink")),
        "exception_type": exc_type or meta.get("type"),
        "exception_value": exc_value or meta.get("value"),
        "platform": event.get("platform"),
        "event_id": event.get("eventID"),
        "event_created": event.get("dateCreated"),
        "frames": frames,
        "tags": [
            {"key": str(t.get("key")), "value": str(t.get("value"))}
            for t in (event.get("tags") or [])
            if t.get("key")
        ],
    }


async def fetch_issues(query: str | None = None, limit: int = 50) -> list[dict]:
    """List issues from the Sentry-compatible REST API (GlitchTip). Returns a
    normalized, secret-free subset. Raises RuntimeError when unconfigured and
    lets httpx errors propagate to the router for a clean 502."""
    if not api_configured():
        raise RuntimeError("Issue API is not configured (token/org/project slug missing).")

    import httpx

    base = _api_base()
    url = f"{base}/api/0/projects/{SENTRY_ORG_SLUG}/{SENTRY_PROJECT_SLUG}/issues/"
    params: dict[str, object] = {"limit": max(1, min(limit, 100))}
    # Default to open issues unless the caller narrows it (Sentry query syntax).
    params["query"] = query if query is not None else "is:unresolved"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url, params=params, headers={"Authorization": f"Bearer {SENTRY_API_TOKEN}"}
        )
        resp.raise_for_status()
        raw = resp.json()

    issues: list[dict] = []
    for it in raw if isinstance(raw, list) else []:
        issue_id = str(it.get("id", ""))
        issues.append(
            {
                "id": issue_id,
                "short_id": it.get("shortId"),
                "title": it.get("title") or it.get("culprit") or "(untitled)",
                "culprit": it.get("culprit"),
                "level": it.get("level"),
                "status": it.get("status"),
                "count": int(it.get("count") or 0),
                "user_count": int(it.get("userCount") or 0),
                "first_seen": it.get("firstSeen"),
                "last_seen": it.get("lastSeen"),
                "web_url": _issue_web_url(issue_id, it.get("permalink")),
            }
        )
    return issues


async def resolve_issue(issue_id: str) -> None:
    """Mark an issue as resolved in GlitchTip/Sentry. Raises when unconfigured
    or when the API call fails."""
    if not api_configured():
        raise RuntimeError("Issue API is not configured (token/org/project slug missing).")

    import httpx

    base = _api_base()
    url = f"{base}/api/0/projects/{SENTRY_ORG_SLUG}/{SENTRY_PROJECT_SLUG}/issues/{issue_id}/"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.put(
            url,
            json={"status": "resolved"},
            headers={"Authorization": f"Bearer {SENTRY_API_TOKEN}"},
        )
        resp.raise_for_status()
