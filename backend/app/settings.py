"""Runtime app settings + first-run onboarding.

A single row (app_settings.id = 1) holds the instance's identity and
preferences — app name, logo, default language, currency, timezone, demo
toggle, and the outbound-email from/support identity. These are set once by the
public onboarding wizard on a fresh instance and read at runtime, so the app
can be branded without a rebuild. Secrets (SMTP/Resend credentials, JWT, DB,
encryption keys) stay in .env and are NEVER stored here.

Onboarding is public ONLY while `onboarded` is false; once complete the
onboard endpoint returns 409. Canonical DDL: migrations/0010_app_settings.sql.

A tiny in-memory cache (`_CACHE`) mirrors the from-identity + demo flag so
synchronous callers that can't touch the async pool (mailer runs in a
threadpool) can read them without a DB round-trip. It is refreshed on startup
and after every write.
"""
import zoneinfo

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel

from . import db, security
from .auth import UserOut
from .roles import ADMIN_ROLE, require_permission

router = APIRouter(prefix="/settings", tags=["settings"])

LOGO_MAX_BYTES = 2 * 1024 * 1024  # 2 MiB
VALID_LANGUAGES = {"en", "lt"}
_AVAILABLE_TZ = zoneinfo.available_timezones()

CREATE_SCHEMA = """
CREATE TABLE IF NOT EXISTS app_settings (
    id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    onboarded        boolean     NOT NULL DEFAULT false,
    app_name         text        NOT NULL DEFAULT 'Tillforty',
    default_language text        NOT NULL DEFAULT 'en',
    currency_code    text        NOT NULL DEFAULT 'EUR',
    currency_symbol  text        NOT NULL DEFAULT '€',
    timezone         text        NOT NULL DEFAULT 'Europe/Vilnius',
    demo_mode        boolean     NOT NULL DEFAULT false,
    from_name        text        NOT NULL DEFAULT '',
    from_email       text        NOT NULL DEFAULT '',
    support_email    text        NOT NULL DEFAULT '',
    logo             bytea,
    logo_mime        text,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
"""

# Idempotent self-heal for databases created before this module existed.
_ALTERS = [
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS app_name text NOT NULL DEFAULT 'Tillforty'",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'en'",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'EUR'",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS currency_symbol text NOT NULL DEFAULT '€'",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Vilnius'",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS from_name text NOT NULL DEFAULT ''",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS from_email text NOT NULL DEFAULT ''",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS support_email text NOT NULL DEFAULT ''",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS logo bytea",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS logo_mime text",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()",
]


# ── Synchronous cache (for the mailer + demo, which can't await the pool) ──────
_CACHE: dict = {"from_name": "", "from_email": "", "demo_mode": False, "onboarded": False}


def get_from_identity() -> tuple[str, str]:
    """(from_name, from_email) from the cache; empty strings when unset."""
    return _CACHE.get("from_name", ""), _CACHE.get("from_email", "")


def demo_mode_cached() -> bool:
    return bool(_CACHE.get("demo_mode", False))


def onboarded_cached() -> bool:
    return bool(_CACHE.get("onboarded", False))


def _refresh_cache(row) -> None:
    if row is None:
        return
    _CACHE["from_name"] = row["from_name"] or ""
    _CACHE["from_email"] = row["from_email"] or ""
    _CACHE["demo_mode"] = bool(row["demo_mode"])
    _CACHE["onboarded"] = bool(row["onboarded"])


class PublicSettings(BaseModel):
    """Bootstrap payload for the SPA — no secrets, no logo bytes."""
    onboarded: bool
    app_name: str
    has_logo: bool
    logo_url: str | None
    default_language: str
    currency_code: str
    currency_symbol: str
    timezone: str
    demo_enabled: bool


class AdminSettings(BaseModel):
    """Full editable settings for the admin settings page (no logo bytes)."""
    app_name: str
    default_language: str
    currency_code: str
    currency_symbol: str
    timezone: str
    demo_mode: bool
    from_name: str
    from_email: str
    support_email: str
    has_logo: bool
    logo_url: str | None


class SettingsUpdate(BaseModel):
    app_name: str | None = None
    default_language: str | None = None
    currency_code: str | None = None
    currency_symbol: str | None = None
    timezone: str | None = None
    demo_mode: bool | None = None
    from_name: str | None = None
    from_email: str | None = None
    support_email: str | None = None


def _valid_tz(tz: str) -> bool:
    return tz in _AVAILABLE_TZ


async def _apply_db_timezone(conn, tz: str) -> None:
    """Set the database's default timezone. `tz` MUST be pre-validated — neither
    the DB name nor a GUC can be parameterized, so both are interpolated. The DB
    name comes from `current_database()` (our own identifier) and is quoted."""
    if not _valid_tz(tz):
        return
    dbname = await conn.fetchval("SELECT current_database()")
    await conn.execute(f'ALTER DATABASE "{dbname}" SET timezone TO \'{tz}\'')


def _to_public(row) -> PublicSettings:
    return PublicSettings(
        onboarded=row["onboarded"],
        app_name=row["app_name"],
        has_logo=row["logo"] is not None,
        logo_url="/api/settings/logo" if row["logo"] is not None else None,
        default_language=row["default_language"],
        currency_code=row["currency_code"],
        currency_symbol=row["currency_symbol"],
        timezone=row["timezone"],
        demo_enabled=bool(row["demo_mode"]),
    )


async def ensure_schema_and_seed() -> None:
    """Create app_settings, seed the singleton row, apply the DB timezone, and
    warm the sync cache. Runs after roles (admin upsert needs the roles table)
    and before demo (demo seeding now reads app_settings.demo_mode)."""
    pool = db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(CREATE_SCHEMA)
        for stmt in _ALTERS:
            await conn.execute(stmt)
        await conn.execute("INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        row = await conn.fetchrow("SELECT * FROM app_settings WHERE id = 1")
        _refresh_cache(row)
        if row is not None:
            await _apply_db_timezone(conn, row["timezone"])


@router.get("", response_model=PublicSettings)
async def get_settings() -> PublicSettings:
    """Public bootstrap payload. Never selects the logo bytea into the body."""
    row = await db.get_pool().fetchrow("SELECT * FROM app_settings WHERE id = 1")
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Settings not initialized")
    return _to_public(row)


@router.get("/logo")
async def get_logo() -> Response:
    """Public logo bytes (login screen renders it pre-auth). 404 when unset."""
    row = await db.get_pool().fetchrow("SELECT logo, logo_mime FROM app_settings WHERE id = 1")
    if row is None or row["logo"] is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo set")
    return Response(
        content=bytes(row["logo"]),
        media_type=row["logo_mime"] or "image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/admin", response_model=AdminSettings)
async def get_admin_settings(
    _: UserOut = Depends(require_permission("roles:manage")),
) -> AdminSettings:
    """Full settings (incl. the email identity) for the admin edit page."""
    row = await db.get_pool().fetchrow("SELECT * FROM app_settings WHERE id = 1")
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Settings not initialized")
    return AdminSettings(
        app_name=row["app_name"],
        default_language=row["default_language"],
        currency_code=row["currency_code"],
        currency_symbol=row["currency_symbol"],
        timezone=row["timezone"],
        demo_mode=bool(row["demo_mode"]),
        from_name=row["from_name"],
        from_email=row["from_email"],
        support_email=row["support_email"],
        has_logo=row["logo"] is not None,
        logo_url="/api/settings/logo" if row["logo"] is not None else None,
    )


@router.post("/logo", status_code=status.HTTP_204_NO_CONTENT)
async def set_logo(
    logo: UploadFile = File(...),
    _: UserOut = Depends(require_permission("roles:manage")),
) -> Response:
    """Replace the logo after onboarding."""
    data = await logo.read()
    mime = logo.content_type or "application/octet-stream"
    if not mime.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be an image")
    if len(data) > LOGO_MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Logo exceeds the 2 MiB limit")
    await db.get_pool().execute(
        "UPDATE app_settings SET logo = $1, logo_mime = $2, updated_at = now() WHERE id = 1",
        data, mime,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/onboard", status_code=status.HTTP_204_NO_CONTENT)
async def onboard(
    app_name: str = Form(...),
    default_language: str = Form("en"),
    currency_code: str = Form("EUR"),
    currency_symbol: str = Form("€"),
    timezone: str = Form("Europe/Vilnius"),
    demo_mode: bool = Form(False),
    from_name: str = Form(""),
    from_email: str = Form(""),
    support_email: str = Form(""),
    admin_name: str = Form(...),
    admin_surname: str = Form(""),
    admin_email: str = Form(...),
    admin_password: str = Form(...),
    logo: UploadFile | None = File(None),
) -> Response:
    """First-run wizard. Public ONLY while not onboarded (else 409)."""
    pool = db.get_pool()

    # ── validation ──────────────────────────────────────────────────────────
    if not app_name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "App name is required")
    if not admin_name.strip() or not admin_email.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin name and email are required")
    if len(admin_password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 8 characters")
    if default_language not in VALID_LANGUAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported language")
    if not _valid_tz(timezone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown timezone: {timezone}")

    logo_bytes: bytes | None = None
    logo_mime: str | None = None
    if logo is not None and logo.filename:
        logo_bytes = await logo.read()
        logo_mime = logo.content_type or "application/octet-stream"
        if not logo_mime.startswith("image/"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be an image")
        if len(logo_bytes) > LOGO_MAX_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Logo exceeds the 2 MiB limit"
            )

    async with pool.acquire() as conn:
        already = await conn.fetchval("SELECT onboarded FROM app_settings WHERE id = 1")
        if already:
            raise HTTPException(status.HTTP_409_CONFLICT, "Already onboarded")

        async with conn.transaction():
            await conn.execute(
                """
                UPDATE app_settings SET
                    app_name = $1, default_language = $2, currency_code = $3,
                    currency_symbol = $4, timezone = $5, demo_mode = $6,
                    from_name = $7, from_email = $8, support_email = $9,
                    logo = COALESCE($10, logo), logo_mime = COALESCE($11, logo_mime),
                    onboarded = true, updated_at = now()
                WHERE id = 1
                """,
                app_name.strip(), default_language, currency_code.strip(),
                currency_symbol.strip(), timezone, demo_mode,
                from_name.strip(), from_email.strip(), support_email.strip(),
                logo_bytes, logo_mime,
            )

            # Upsert the administrator: claim the existing seeded admin in place,
            # or create one if none exists.
            admin_id = await conn.fetchval(
                "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id "
                "WHERE r.name = $1 ORDER BY u.id LIMIT 1",
                ADMIN_ROLE,
            )
            role_id = await conn.fetchval("SELECT id FROM roles WHERE name = $1", ADMIN_ROLE)
            pw_hash = security.hash_password(admin_password)
            clash = await conn.fetchval(
                "SELECT id FROM users WHERE email = $1", admin_email.strip()
            )
            if clash is not None and clash != admin_id:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "That email already belongs to another user"
                )
            if admin_id is not None:
                await conn.execute(
                    "UPDATE users SET name = $2, surname = $3, email = $4, "
                    "password_hash = $5, status = 'active', role_id = $6 WHERE id = $1",
                    admin_id, admin_name.strip(), admin_surname.strip(),
                    admin_email.strip(), pw_hash, role_id,
                )
            else:
                await conn.execute(
                    "INSERT INTO users (name, surname, email, password_hash, status, role_id) "
                    "VALUES ($1, $2, $3, $4, 'active', $5)",
                    admin_name.strip(), admin_surname.strip(), admin_email.strip(),
                    pw_hash, role_id,
                )

            await _apply_db_timezone(conn, timezone)

        row = await conn.fetchrow("SELECT * FROM app_settings WHERE id = 1")
        _refresh_cache(row)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("", response_model=PublicSettings)
async def update_settings(
    body: SettingsUpdate,
    _: UserOut = Depends(require_permission("roles:manage")),
) -> PublicSettings:
    """Edit settings after onboarding. Reuses the roles:manage permission."""
    if body.default_language is not None and body.default_language not in VALID_LANGUAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported language")
    if body.timezone is not None and not _valid_tz(body.timezone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown timezone: {body.timezone}")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    pool = db.get_pool()
    async with pool.acquire() as conn:
        if fields:
            sets = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(fields))
            await conn.execute(
                f"UPDATE app_settings SET {sets}, updated_at = now() WHERE id = 1",
                *fields.values(),
            )
        if body.timezone is not None:
            await _apply_db_timezone(conn, body.timezone)
        row = await conn.fetchrow("SELECT * FROM app_settings WHERE id = 1")
        _refresh_cache(row)

    # A live demo-mode flip to ON seeds the demo user immediately.
    if body.demo_mode:
        from . import demo
        await demo.ensure_demo_user()

    return _to_public(row)
