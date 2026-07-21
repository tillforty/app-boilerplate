"""Optional demo mode: a public, low-privilege login for showcasing the app.

When DEMO_MODE is on, a demo user (DEMO_USERNAME / DEMO_PASSWORD) is seeded with
the limited 'member' role on startup, and GET /auth/demo advertises the
credentials so the login screen can surface them. The login form is email-based
but matches the stored value as a plain string, so DEMO_USERNAME works as-is
(e.g. literally 'demo'). Configure via environment:

  DEMO_MODE      'true' to enable (default off)
  DEMO_USERNAME  login value for the demo user (default 'demo')
  DEMO_PASSWORD  password for the demo user  (default 'demo')

Intended for public demos only — never enable it on an instance with real data.
"""
import os

from fastapi import APIRouter
from pydantic import BaseModel

from . import db, security, settings
from .roles import MEMBER_ROLE


def _bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


DEMO_MODE = _bool("DEMO_MODE", False)
DEMO_USERNAME = os.environ.get("DEMO_USERNAME", "demo")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo")

router = APIRouter(prefix="/auth", tags=["auth"])


class DemoInfo(BaseModel):
    enabled: bool
    username: str | None = None
    password: str | None = None


def _demo_enabled() -> bool:
    """Runtime demo toggle. Once the instance is onboarded, app_settings is
    authoritative; before that, fall back to the env DEMO_MODE default so
    pre-onboarding behavior is unchanged. Reads the sync settings cache (warmed
    at startup, refreshed on every settings write) — no DB round-trip needed."""
    if settings.onboarded_cached():
        return settings.demo_mode_cached()
    return DEMO_MODE


def is_enabled() -> bool:
    return _demo_enabled()


async def ensure_demo_user() -> None:
    """Seed/refresh the demo user with the 'member' role. Idempotent.

    Must run AFTER roles.ensure_schema_and_seed so the 'member' role exists and
    the role backfill (which makes role-less users administrators) has already
    run — the demo user is inserted with an explicit member role_id so it is
    never elevated to administrator.
    """
    if not _demo_enabled():
        return
    async with db.get_pool().acquire() as conn:
        member_id = await conn.fetchval("SELECT id FROM roles WHERE name = $1", MEMBER_ROLE)
        await conn.execute(
            """
            INSERT INTO users (name, surname, email, password_hash, role_id)
            VALUES ('Demo', 'User', $1, $2, $3)
            ON CONFLICT (email) DO UPDATE
              SET password_hash = EXCLUDED.password_hash,
                  role_id       = EXCLUDED.role_id
            """,
            DEMO_USERNAME,
            security.hash_password(DEMO_PASSWORD),
            member_id,
        )


@router.get("/demo", response_model=DemoInfo)
async def demo_info() -> DemoInfo:
    """Advertise the demo credentials when demo mode is on (else enabled=false)."""
    if not _demo_enabled():
        return DemoInfo(enabled=False)
    return DemoInfo(enabled=True, username=DEMO_USERNAME, password=DEMO_PASSWORD)
