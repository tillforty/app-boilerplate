"""n8n integration: build webhook URLs from env, never hardcode them.

Configure via environment (leave unset to disable n8n calls entirely):

  N8N_BASE_URL     root of the n8n instance, e.g. https://n8n.example.com
  N8N_WEBHOOK_URL  base for production webhooks; defaults to {N8N_BASE_URL}/webhook

A webhook's full URL is {N8N_WEBHOOK_URL}/{path}, where `path` is the path
configured on the n8n Webhook trigger node. `fire_webhook` is best-effort: it
no-ops when nothing is configured, so apps run without n8n in dev.
"""
import os

import httpx

N8N_BASE_URL = os.environ.get("N8N_BASE_URL", "").rstrip("/")
N8N_WEBHOOK_URL = (
    os.environ.get("N8N_WEBHOOK_URL")
    or (f"{N8N_BASE_URL}/webhook" if N8N_BASE_URL else "")
).rstrip("/")


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
        # Best-effort: swallow so the caller's primary work still succeeds.
        pass
