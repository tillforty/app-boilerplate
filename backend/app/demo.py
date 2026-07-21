"""Optional demo mode: a public login for showcasing the app.

When DEMO_MODE is on, a demo user (DEMO_USERNAME / DEMO_PASSWORD) is seeded with
the 'administrator' role on startup so demo visitors get the full admin
experience, and GET /auth/demo advertises the credentials so the login screen
can surface them. NOTE: this makes the public demo login a full administrator —
only enable demo mode on a throwaway/showcase instance, never on real data. The
login form is email-based but matches the stored value as a plain string, so
DEMO_USERNAME works as-is (e.g. literally 'demo'). Configure via environment:

  DEMO_MODE      'true' to enable (default off)
  DEMO_USERNAME  login value for the demo user (default 'demo')
  DEMO_PASSWORD  password for the demo user  (default 'demo')

Intended for public demos only — never enable it on an instance with real data.
"""
import os

from fastapi import APIRouter
from pydantic import BaseModel

from . import db, security, settings
from .roles import ADMIN_ROLE


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
    """Sync the demo user to the current demo toggle. Idempotent.

    Enabled  → seed/refresh the demo user as an ACTIVE administrator.
    Disabled → deactivate any existing demo user (status='inactive') so the
    public demo/demo credentials can no longer log in. Turning demo off (in the
    onboarding wizard or settings) must not leave a live admin backdoor behind.

    Must run AFTER roles.ensure_schema_and_seed so the 'administrator' role and
    the role backfill exist.
    """
    async with db.get_pool().acquire() as conn:
        if not _demo_enabled():
            await conn.execute(
                "UPDATE users SET status = 'inactive' WHERE email = $1", DEMO_USERNAME
            )
            return
        admin_id = await conn.fetchval("SELECT id FROM roles WHERE name = $1", ADMIN_ROLE)
        await conn.execute(
            """
            INSERT INTO users (name, surname, email, password_hash, role_id, status)
            VALUES ('Demo', 'User', $1, $2, $3, 'active')
            ON CONFLICT (email) DO UPDATE
              SET password_hash = EXCLUDED.password_hash,
                  role_id       = EXCLUDED.role_id,
                  status        = 'active'
            """,
            DEMO_USERNAME,
            security.hash_password(DEMO_PASSWORD),
            admin_id,
        )


@router.get("/demo", response_model=DemoInfo)
async def demo_info() -> DemoInfo:
    """Advertise the demo credentials when demo mode is on (else enabled=false)."""
    if not _demo_enabled():
        return DemoInfo(enabled=False)
    return DemoInfo(enabled=True, username=DEMO_USERNAME, password=DEMO_PASSWORD)
