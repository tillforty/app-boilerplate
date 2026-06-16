"""Outbound email: build an SMTP sender from env, never hardcode credentials.

Configure via environment (leave SMTP_HOST unset to disable sending entirely):

  SMTP_HOST        SMTP server hostname, e.g. smtp.gmail.com
  SMTP_PORT        587 = STARTTLS (default), 465 = implicit TLS/SSL, 25 = plain
  SMTP_USERNAME    login username (often the full from-address)
  SMTP_PASSWORD    login password / app password
  SMTP_STARTTLS    upgrade the connection with STARTTLS (true for 587)
  SMTP_SSL         use implicit TLS from the start (true for 465)
  SMTP_FROM_EMAIL  envelope/from address (defaults to SMTP_USERNAME)
  SMTP_FROM_NAME   display name shown to recipients

`send_email` is best-effort: it no-ops when SMTP is unconfigured, so apps run
without email in dev. Uses the stdlib smtplib — no extra dependency. SMTP I/O is
blocking; call it from a threadpool (e.g. fastapi.concurrency.run_in_threadpool)
or a background task so it doesn't stall the event loop.
"""
import os
import smtplib
from email.message import EmailMessage


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None or val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT") or "587")
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_STARTTLS = _bool("SMTP_STARTTLS", True)
SMTP_SSL = _bool("SMTP_SSL", False)
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL") or SMTP_USERNAME
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "")


def is_configured() -> bool:
    """True when an SMTP server is available from the environment."""
    return bool(SMTP_HOST)


def send_email(
    to: str | list[str],
    subject: str,
    body: str,
    *,
    html: str | None = None,
    timeout: float = 15.0,
) -> bool:
    """Send a plain-text (and optional HTML) email. Returns True if sent.

    Best-effort: returns False without raising when SMTP is unconfigured or the
    send fails, so a failed notification can't break the calling request. Raise
    your own error instead if delivery is critical (check is_configured() first).
    """
    if not SMTP_HOST:
        return False

    recipients = [to] if isinstance(to, str) else list(to)
    if not recipients:
        return False

    msg = EmailMessage()
    from_addr = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>" if SMTP_FROM_NAME else SMTP_FROM_EMAIL
    msg["From"] = from_addr
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
