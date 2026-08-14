"""n8n integration: build webhook URLs from env, never hardcode them, plus a
thin read client for n8n's public REST API (Settings › Operations).

Configure via environment (leave unset to disable n8n calls entirely):

  N8N_BASE_URL     root of the n8n instance, e.g. https://n8n.example.com.
                   Inside this compose stack that is http://n8n:5678.
  N8N_WEBHOOK_URL  base for production webhooks; defaults to {N8N_BASE_URL}/webhook
  N8N_API_KEY      personal API key (n8n UI → Settings → n8n API). Read-only
                   scopes are enough: execution:read/list, workflow:read/list.
  N8N_PUBLIC_URL   browser-facing URL of the n8n UI, used for the "open in n8n"
                   links. Defaults to {N8N_PROTOCOL}://{N8N_HOST}:{N8N_PORT}.

A webhook's full URL is {N8N_WEBHOOK_URL}/{path}, where `path` is the path
configured on the n8n Webhook trigger node. `fire_webhook` is best-effort: it
no-ops when nothing is configured, so apps run without n8n in dev.
"""
import logging
import os
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

N8N_BASE_URL = os.environ.get("N8N_BASE_URL", "").rstrip("/")
N8N_WEBHOOK_URL = (
    os.environ.get("N8N_WEBHOOK_URL")
    or (f"{N8N_BASE_URL}/webhook" if N8N_BASE_URL else "")
).rstrip("/")
N8N_API_KEY = os.environ.get("N8N_API_KEY", "").strip()

# Execution states the public API accepts as a `status` filter. Anything else is
# rejected before the call so a typo can't turn into a confusing 400 from n8n.
EXECUTION_STATUSES = ("success", "error", "waiting", "canceled", "running", "new")


def is_configured() -> bool:
    """True when an n8n webhook base URL is available from the environment."""
    return bool(N8N_WEBHOOK_URL)


def webhook_url(path: str) -> str:
    """Absolute URL for the n8n webhook at `path` (the trigger node's path)."""
    if not N8N_WEBHOOK_URL:
        raise RuntimeError("N8N_WEBHOOK_URL (or N8N_BASE_URL) is not configured")
    return f"{N8N_WEBHOOK_URL}/{path.lstrip('/')}"


async def fire_webhook(path: str, payload: dict, *, timeout: float = 10.0) -> None:
    """POST `payload` as JSON to an n8n webhook. Best-effort: no-op when n8n is
    unconfigured, and never raises on transport/HTTP errors so a failed webhook
    can't break the calling request."""
    if not N8N_WEBHOOK_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            await client.post(webhook_url(path), json=payload)
    except httpx.HTTPError:
        # Best-effort: log and continue so the caller's primary work still
        # succeeds, but don't swallow the failure silently.
        logger.warning("n8n webhook POST to %r failed", path, exc_info=True)


# ── Public REST API (read-only) ─────────────────────────────────────────────
# Backs Settings › Operations. Unlike fire_webhook these are NOT best-effort:
# the page needs to tell "n8n says there are no executions" apart from "n8n is
# unreachable", so failures propagate to the router as 409/502.


def public_url() -> str:
    """Browser-facing root of the n8n UI (for 'open in n8n' links). The API base
    is usually the in-network service name, which a browser can't resolve."""
    explicit = os.environ.get("N8N_PUBLIC_URL", "").rstrip("/")
    if explicit:
        return explicit
    proto = os.environ.get("N8N_PROTOCOL") or "http"
    host = os.environ.get("N8N_HOST") or "localhost"
    port = os.environ.get("N8N_PORT") or "5678"
    return f"{proto}://{host}:{port}"


def api_configured() -> bool:
    """True when both the instance URL and an API key are set."""
    return bool(N8N_BASE_URL and N8N_API_KEY)


def setup_status() -> dict:
    """Per-requirement flags driving the Operations setup checklist."""
    return {
        "base_url_configured": bool(N8N_BASE_URL),
        "api_key_configured": bool(N8N_API_KEY),
        "api_configured": api_configured(),
        "ui_url": public_url(),
    }


async def _api_get(path: str, params: dict | None = None) -> dict:
    """GET on the n8n public API. Raises RuntimeError when unconfigured and lets
    httpx errors propagate so the router can answer 502."""
    if not api_configured():
        raise RuntimeError("n8n API is not configured (base URL or API key missing).")
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{N8N_BASE_URL}/api/v1/{path.lstrip('/')}",
            params=params or {},
            headers={"X-N8N-API-KEY": N8N_API_KEY, "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _duration_ms(started: str | None, stopped: str | None) -> int | None:
    """Wall-clock run time, or None while an execution is still going."""
    a, b = _parse_dt(started), _parse_dt(stopped)
    if a is None or b is None:
        return None
    return max(0, int((b - a).total_seconds() * 1000))


async def fetch_workflow_names() -> dict[str, str]:
    """id → name for every workflow. The executions endpoint only carries the
    workflow id unless the (heavy) run data is requested, so names are joined in
    from this one extra call."""
    names: dict[str, str] = {}
    cursor: str | None = None
    # Paginate defensively; instances with hundreds of workflows are normal.
    for _ in range(10):
        params: dict[str, object] = {"limit": 250}
        if cursor:
            params["cursor"] = cursor
        payload = await _api_get("workflows", params)
        for wf in payload.get("data") or []:
            if wf.get("id") is not None:
                names[str(wf["id"])] = wf.get("name") or ""
        cursor = payload.get("nextCursor")
        if not cursor:
            break
    return names


def _execution_web_url(workflow_id: str, execution_id: str) -> str | None:
    if not workflow_id or not execution_id:
        return None
    return f"{public_url()}/workflow/{workflow_id}/executions/{execution_id}"


async def fetch_executions(
    *,
    limit: int = 50,
    status: str | None = None,
    workflow_id: str | None = None,
    cursor: str | None = None,
) -> dict:
    """A page of executions, normalized and with workflow names joined in.

    Returns {"executions": [...], "next_cursor": str | None}. `includeData` is
    deliberately never set — run payloads can be megabytes and the list only
    needs the summary.
    """
    params: dict[str, object] = {"limit": max(1, min(limit, 250)), "includeData": False}
    if status:
        if status not in EXECUTION_STATUSES:
            raise ValueError(f"Unsupported execution status: {status}")
        params["status"] = status
    if workflow_id:
        params["workflowId"] = workflow_id
    if cursor:
        params["cursor"] = cursor

    payload = await _api_get("executions", params)
    rows = payload.get("data") or []
    names = await fetch_workflow_names() if rows else {}

    executions = []
    for it in rows:
        exec_id = str(it.get("id", ""))
        wf_id = str(it.get("workflowId") or "")
        executions.append(
            {
                "id": exec_id,
                "workflow_id": wf_id or None,
                "workflow_name": names.get(wf_id) or None,
                # n8n only sets `status` from 1.x on; `finished` is the fallback.
                "status": it.get("status") or ("success" if it.get("finished") else "error"),
                "mode": it.get("mode"),
                "finished": bool(it.get("finished")),
                "retry_of": str(it["retryOf"]) if it.get("retryOf") else None,
                "started_at": it.get("startedAt"),
                "stopped_at": it.get("stoppedAt"),
                "duration_ms": _duration_ms(it.get("startedAt"), it.get("stoppedAt")),
                "web_url": _execution_web_url(wf_id, exec_id),
            }
        )
    return {"executions": executions, "next_cursor": payload.get("nextCursor")}


async def fetch_workflows() -> list[dict]:
    """Workflows as {id, name, active} — the Operations filter dropdown."""
    payload = await _api_get("workflows", {"limit": 250})
    return [
        {
            "id": str(wf.get("id", "")),
            "name": wf.get("name") or "",
            "active": bool(wf.get("active")),
        }
        for wf in payload.get("data") or []
        if wf.get("id") is not None
    ]
