"""Outbound email: pick a transport from env, never hardcode credentials.

Two transports, tried in this order (leave both unset to disable sending
entirely — `send_email` then no-ops so apps run without email in dev):

  1. Resend HTTP API — set RESEND_API_KEY. Preferred: no SMTP round-trips, and
     Resend records every send in its dashboard/logs.
  2. SMTP — set SMTP_HOST (works with any provider, incl. Resend's SMTP bridge).

Environment:

  RESEND_API_KEY   Resend API key (re_…); when set, send via the HTTP API
  SMTP_HOST        SMTP server hostname, e.g. smtp.gmail.com
  SMTP_PORT        587 = STARTTLS (default), 465 = implicit TLS/SSL, 25 = plain
  SMTP_USERNAME    login username (often the full from-address)
  SMTP_PASSWORD    login password / app password / Resend API key (SMTP bridge)
  SMTP_STARTTLS    upgrade the connection with STARTTLS (true for 587)
  SMTP_SSL         use implicit TLS from the start (true for 465)
  SMTP_FROM_EMAIL  envelope/from address (defaults to SMTP_USERNAME)
  SMTP_FROM_NAME   display name shown to recipients

`send_email` is best-effort: it returns False (never raises) when unconfigured
or the send fails, so a failed notification can't break the calling request.
Both transports do blocking I/O; call from a threadpool (e.g.
fastapi.concurrency.run_in_threadpool) or a background task so the event loop
isn't stalled.
"""
import os
import smtplib
from email.message import EmailMessage

import httpx


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None or val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
RESEND_API_URL = "https://api.resend.com/emails"

SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT") or "587")
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_STARTTLS = _bool("SMTP_STARTTLS", True)
SMTP_SSL = _bool("SMTP_SSL", False)
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL") or SMTP_USERNAME
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "")


def is_configured() -> bool:
    """True when at least one email transport (Resend or SMTP) is available."""
    return bool(RESEND_API_KEY or SMTP_HOST)


def _from_address() -> str:
    # The from IDENTITY (name + address) is editable via app_settings; the
    # transport CREDENTIALS above are not. Read the identity from the settings
    # sync cache (this runs in a threadpool, so it can't await the DB pool),
    # falling back to the env values when unset. Lazy import avoids a cycle
    # (auth → mailer, settings → auth).
    name, email = SMTP_FROM_NAME, SMTP_FROM_EMAIL
    try:
        from . import settings

        s_name, s_email = settings.get_from_identity()
        if s_email:
            email = s_email
        if s_name:
            name = s_name
    except Exception:
        pass  # best-effort, matches the mailer's swallow-and-continue ethos
    return f"{name} <{email}>" if name else email


def _send_via_resend(
    recipients: list[str], subject: str, body: str, html: str | None, timeout: float
) -> bool:
    """POST the message to the Resend API. Returns True on a 2xx response."""
    payload: dict = {
        "from": _from_address(),
        "to": recipients,
        "subject": subject,
        "text": body,
    }
    if html is not None:
        payload["html"] = html
    try:
        resp = httpx.post(
            RESEND_API_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
                # Resend's API sits behind Cloudflare, which blocks some default
                # client User-Agents (e.g. python-urllib) with a 1010 error.
                "User-Agent": "tillforty-mailer/1.0",
            },
            timeout=timeout,
        )
        return resp.status_code < 300
    except httpx.HTTPError:
        # Best-effort: swallow so the caller's primary work still succeeds.
        return False


def _send_via_smtp(
    recipients: list[str], subject: str, body: str, html: str | None, timeout: float
) -> bool:
    """Send the message over SMTP. Returns True if the server accepted it."""
    msg = EmailMessage()
    msg["From"] = _from_address()
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)
    if html is not None:
        msg.add_alternative(html, subtype="html")

    try:
        if SMTP_SSL:
            smtp: smtplib.SMTP = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=timeout)
        else:
            smtp = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=timeout)
        with smtp:
            if SMTP_STARTTLS and not SMTP_SSL:
                smtp.starttls()
            if SMTP_USERNAME:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError):
        # Best-effort: swallow so the caller's primary work still succeeds.
        return False


def send_email(
    to: str | list[str],
    subject: str,
    body: str,
    *,
    html: str | None = None,
    timeout: float = 15.0,
) -> bool:
    """Send a plain-text (and optional HTML) email. Returns True if sent.

    Prefers the Resend HTTP API when RESEND_API_KEY is set, otherwise falls back
    to SMTP. Best-effort: returns False without raising when no transport is
    configured or the send fails, so a failed notification can't break the
    calling request. Raise your own error instead if delivery is critical
    (check is_configured() first).
    """
    recipients = [to] if isinstance(to, str) else list(to)
    if not recipients:
        return False

    if RESEND_API_KEY:
        return _send_via_resend(recipients, subject, body, html, timeout)
    if SMTP_HOST:
        return _send_via_smtp(recipients, subject, body, html, timeout)
    return False
