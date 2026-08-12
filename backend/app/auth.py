"""Authentication: users table, login (JWT), and the current-user dependency.

Self-registration is intentionally not exposed. The single initial user is
seeded on startup from the SEED_USER_* environment variables (see
ensure_schema_and_seed); further users are created by admins via
POST /auth/users (guarded by the 'users:create' permission).
The canonical DDL also lives in migrations/0002_users.sql.
"""
import os
import secrets
from datetime import datetime, timedelta, timezone

import asyncpg
import jwt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

from . import db, mailer, security
from .ratelimit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

CREATE_USERS_TABLE = """
CREATE TABLE IF NOT EXISTS users (
    id            bigserial PRIMARY KEY,
    name          text NOT NULL,
    surname       text NOT NULL,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
"""


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    surname: str
    email: str


class UserListItem(BaseModel):
    """Row for the users admin table: identity + role name + lifecycle status.

    invite_token is only populated for pending users AND only when the caller
    holds 'users:create' (it grants account takeover of the pending user).
    """
    id: int
    name: str
    surname: str
    email: str
    role: str | None = None
    status: str = "active"
    invite_token: str | None = None
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProfileUpdate(BaseModel):
    name: str | None = None
    surname: str | None = None
    email: EmailStr | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class UserCreate(BaseModel):
    name: str
    surname: str
    email: EmailStr
    password: str
    role_id: int | None = None  # defaults to the 'member' role when omitted


class InviteCreate(BaseModel):
    name: str
    surname: str
    email: EmailStr
    role_id: int | None = None  # defaults to the 'member' role when omitted


class InviteOut(UserListItem):
    invite_url: str
    email_sent: bool


class InviteInfo(BaseModel):
    """What the public acceptance page may see about an invitation."""
    name: str
    surname: str
    email: str


class InviteAccept(BaseModel):
    password: str


# Invitations expire after this many days; resending refreshes the window.
INVITE_EXPIRE_DAYS = int(os.environ.get("INVITE_EXPIRE_DAYS") or "7")


def invite_url(token: str) -> str:
    """Absolute URL of the public acceptance page (path-only if no domain set)."""
    base = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not base:
        domain = os.environ.get("DOMAIN", "").strip()
        if domain:
            base = f"https://{domain}"
    return f"{base}/invite/{token}"


def _send_invite_email(to: str, name: str, url: str) -> None:
    """Best-effort invitation email (no-op when SMTP is unconfigured)."""
    app_name = mailer.SMTP_FROM_NAME or os.environ.get("DOMAIN", "").strip() or "the app"
    mailer.send_email(
        to,
        f"You're invited to {app_name}",
        f"Hi {name},\n\n"
        f"You've been invited to {app_name}. Open the link below to set your "
        f"password and activate your account (the link expires in "
        f"{INVITE_EXPIRE_DAYS} days):\n\n{url}\n",
    )


async def ensure_schema_and_seed() -> None:
    """Create the users table if missing and seed the initial user once."""
    pool = db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(CREATE_USERS_TABLE)
        # Lifecycle columns (canonical DDL in migrations/0008_user_lifecycle.sql);
        # idempotent so pre-migration databases self-heal on startup.
        await conn.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
        await conn.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'"
        )
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token text UNIQUE")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at timestamptz")

        email = os.environ.get("SEED_USER_EMAIL")
        password = os.environ.get("SEED_USER_PASSWORD")
        if email and password:
            exists = await conn.fetchval("SELECT 1 FROM users WHERE email = $1", email)
            if not exists:
                await conn.execute(
                    "INSERT INTO users (name, surname, email, password_hash) "
                    "VALUES ($1, $2, $3, $4)",
                    os.environ.get("SEED_USER_NAME", ""),
                    os.environ.get("SEED_USER_SURNAME", ""),
                    email,
                    security.hash_password(password),
                )


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserOut:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = security.decode_token(creds.credentials)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        # Bad signature/expiry, or a token with a missing/non-numeric `sub` — all
        # map to 401 rather than surfacing a 500 from int()/KeyError.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    row = await db.get_pool().fetchrow(
        "SELECT id, name, surname, email, status FROM users WHERE id = $1",
        user_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    # Deactivation invalidates already-issued tokens on their next use.
    if row["status"] != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is deactivated")
    return UserOut(id=row["id"], name=row["name"], surname=row["surname"], email=row["email"])


async def require_users_read(current: "UserOut" = Depends(get_current_user)) -> "UserOut":
    """Guard the users listing behind the 'users:read' permission.

    Imported lazily to avoid a circular import (roles imports auth at module
    load); the check itself reuses the roles permission helpers.
    """
    from .roles import WILDCARD, get_user_permissions

    perms = await get_user_permissions(current.id)
    if WILDCARD in perms or "users:read" in perms:
        return current
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing permission: users:read")


async def require_users_create(current: "UserOut" = Depends(get_current_user)) -> "UserOut":
    """Guard user creation behind the 'users:create' permission (lazy import as above)."""
    from .roles import WILDCARD, get_user_permissions

    perms = await get_user_permissions(current.id)
    if WILDCARD in perms or "users:create" in perms:
        return current
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing permission: users:create")


def _set_auth_cookie(response: Response, token: str) -> None:
    """Set the access_token cookie (used to authorise browser access to /docs)."""
    response.set_cookie(
        "access_token",
        token,
        httponly=True,
        samesite="lax",
        secure=True,
        max_age=security.JWT_EXPIRE_MINUTES * 60,
    )


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, response: Response) -> LoginResponse:
    row = await db.get_pool().fetchrow(
        "SELECT id, name, surname, email, password_hash, status FROM users WHERE email = $1",
        body.email,
    )
    # Pending users have no password yet, so they fall into the generic 401.
    if (
        row is None
        or row["password_hash"] is None
        or not security.verify_password(body.password, row["password_hash"])
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if row["status"] != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is deactivated")

    token = security.create_access_token(str(row["id"]))
    _set_auth_cookie(response, token)
    return LoginResponse(
        access_token=token,
        user=UserOut(id=row["id"], name=row["name"], surname=row["surname"], email=row["email"]),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie("access_token")


@router.get("/me", response_model=UserOut)
async def me(current: UserOut = Depends(get_current_user)) -> UserOut:
    return current


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfileUpdate, current: UserOut = Depends(get_current_user)) -> UserOut:
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        return current
    sets = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(fields))
    try:
        row = await db.get_pool().fetchrow(
            f"UPDATE users SET {sets} WHERE id = $1 RETURNING id, name, surname, email",
            current.id,
            *fields.values(),
        )
    except asyncpg.UniqueViolationError:
        # email has a UNIQUE constraint — surface a clean 409 instead of a 500.
        raise HTTPException(status.HTTP_409_CONFLICT, "That email is already in use")
    return UserOut(**dict(row))


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChange, current: UserOut = Depends(get_current_user)
) -> None:
    row = await db.get_pool().fetchrow(
        "SELECT password_hash FROM users WHERE id = $1", current.id
    )
    if row is None or not security.verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    await db.get_pool().execute(
        "UPDATE users SET password_hash = $2 WHERE id = $1",
        current.id,
        security.hash_password(body.new_password),
    )


@router.post("/users", response_model=UserListItem, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate, _: UserOut = Depends(require_users_create)
) -> UserListItem:
    from .roles import MEMBER_ROLE

    name = body.name.strip()
    surname = body.surname.strip()
    email = body.email.strip()
    if not name or not surname or not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name, surname and email are required")
    if len(body.password) < 8:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Password must be at least 8 characters"
        )

    pool = db.get_pool()
    if body.role_id is not None:
        role_id = await pool.fetchval("SELECT id FROM roles WHERE id = $1", body.role_id)
        if role_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    else:
        role_id = await pool.fetchval("SELECT id FROM roles WHERE name = $1", MEMBER_ROLE)

    try:
        row = await pool.fetchrow(
            "INSERT INTO users (name, surname, email, password_hash, role_id) "
            "VALUES ($1, $2, $3, $4, $5) "
            "RETURNING id, name, surname, email, status, created_at",
            name,
            surname,
            email,
            security.hash_password(body.password),
            role_id,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")

    role_name = await pool.fetchval("SELECT name FROM roles WHERE id = $1", role_id)
    return UserListItem(**dict(row), role=role_name)


@router.post("/users/invite", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def invite_user(
    body: InviteCreate,
    background: BackgroundTasks,
    _: UserOut = Depends(require_users_create),
) -> InviteOut:
    from .roles import MEMBER_ROLE

    name = body.name.strip()
    surname = body.surname.strip()
    email = body.email.strip()
    if not name or not surname or not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name, surname and email are required")

    pool = db.get_pool()
    if body.role_id is not None:
        role_id = await pool.fetchval("SELECT id FROM roles WHERE id = $1", body.role_id)
        if role_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    else:
        role_id = await pool.fetchval("SELECT id FROM roles WHERE name = $1", MEMBER_ROLE)

    token = secrets.token_urlsafe(32)
    try:
        row = await pool.fetchrow(
            "INSERT INTO users (name, surname, email, role_id, status, invite_token, invited_at) "
            "VALUES ($1, $2, $3, $4, 'pending', $5, now()) "
            "RETURNING id, name, surname, email, status, invite_token, created_at",
            name,
            surname,
            email,
            role_id,
            token,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")

    url = invite_url(token)
    email_sent = mailer.is_configured()
    if email_sent:
        background.add_task(_send_invite_email, email, name, url)

    role_name = await pool.fetchval("SELECT name FROM roles WHERE id = $1", role_id)
    return InviteOut(**dict(row), role=role_name, invite_url=url, email_sent=email_sent)


@router.post("/users/{user_id}/invite/resend", response_model=InviteOut)
async def resend_invite(
    user_id: int,
    background: BackgroundTasks,
    _: UserOut = Depends(require_users_create),
) -> InviteOut:
    """Issue a fresh token (old link stops working) and re-email it if possible."""
    pool = db.get_pool()
    token = secrets.token_urlsafe(32)
    row = await pool.fetchrow(
        "UPDATE users SET invite_token = $2, invited_at = now() "
        "WHERE id = $1 AND status = 'pending' "
        "RETURNING id, name, surname, email, status, invite_token, role_id, created_at",
        user_id,
        token,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No pending invitation for that user")

    url = invite_url(token)
    email_sent = mailer.is_configured()
    if email_sent:
        background.add_task(_send_invite_email, row["email"], row["name"], url)

    role_name = await pool.fetchval("SELECT name FROM roles WHERE id = $1", row["role_id"])
    return InviteOut(
        id=row["id"], name=row["name"], surname=row["surname"], email=row["email"],
        status=row["status"], invite_token=row["invite_token"], created_at=row["created_at"],
        role=role_name, invite_url=url, email_sent=email_sent,
    )


async def _valid_invite(token: str) -> asyncpg.Record:
    """The pending, unexpired user for an invite token, or a 404/410 error."""
    row = await db.get_pool().fetchrow(
        "SELECT id, name, surname, email, invited_at FROM users "
        "WHERE invite_token = $1 AND status = 'pending'",
        token,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    expires = row["invited_at"] + timedelta(days=INVITE_EXPIRE_DAYS)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(
            status.HTTP_410_GONE, "This invitation has expired — ask for a new one"
        )
    return row


@router.get("/invite/{token}", response_model=InviteInfo)
async def get_invite(token: str) -> InviteInfo:
    """Public: who this invitation is for, so the acceptance page can greet them."""
    row = await _valid_invite(token)
    return InviteInfo(name=row["name"], surname=row["surname"], email=row["email"])


@router.post("/invite/{token}/accept", response_model=LoginResponse)
@limiter.limit("10/minute")
async def accept_invite(
    request: Request, token: str, body: InviteAccept, response: Response
) -> LoginResponse:
    """Public: set the password, activate the account, and log the user in."""
    if len(body.password) < 8:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Password must be at least 8 characters"
        )
    row = await _valid_invite(token)
    await db.get_pool().execute(
        "UPDATE users SET password_hash = $2, status = 'active', invite_token = NULL "
        "WHERE id = $1",
        row["id"],
        security.hash_password(body.password),
    )
    jwt_token = security.create_access_token(str(row["id"]))
    _set_auth_cookie(response, jwt_token)
    return LoginResponse(
        access_token=jwt_token,
        user=UserOut(id=row["id"], name=row["name"], surname=row["surname"], email=row["email"]),
    )


async def require_users_delete(current: "UserOut" = Depends(get_current_user)) -> "UserOut":
    """Guard deactivate/activate behind the 'users:delete' permission (lazy import as above)."""
    from .roles import WILDCARD, get_user_permissions

    perms = await get_user_permissions(current.id)
    if WILDCARD in perms or "users:delete" in perms:
        return current
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing permission: users:delete")


@router.post("/users/{user_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: int, current: UserOut = Depends(require_users_delete)
) -> None:
    """Archive a user (soft delete): they keep their data but can no longer log in."""
    if user_id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate yourself")
    updated = await db.get_pool().fetchval(
        "UPDATE users SET status = 'inactive' WHERE id = $1 RETURNING id", user_id
    )
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")


@router.post("/users/{user_id}/activate", status_code=status.HTTP_204_NO_CONTENT)
async def activate_user(user_id: int, _: UserOut = Depends(require_users_delete)) -> None:
    """Restore an inactive user. Users who never set a password go back to pending."""
    updated = await db.get_pool().fetchval(
        "UPDATE users SET status = CASE WHEN password_hash IS NULL THEN 'pending' ELSE 'active' END "
        "WHERE id = $1 AND status = 'inactive' RETURNING id",
        user_id,
    )
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No inactive user with that id")


@router.get("/users", response_model=list[UserListItem])
async def list_users(current: UserOut = Depends(require_users_read)) -> list[UserListItem]:
    from .roles import WILDCARD, get_user_permissions

    rows = await db.get_pool().fetch(
        """
        SELECT u.id, u.name, u.surname, u.email, u.status, u.invite_token, u.created_at,
               r.name AS role
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        ORDER BY u.id
        """
    )
    # Invite tokens grant account takeover of pending users — only expose them
    # to callers who could have issued the invite in the first place.
    perms = await get_user_permissions(current.id)
    show_tokens = WILDCARD in perms or "users:create" in perms
    return [
        UserListItem(**{**dict(r), "invite_token": r["invite_token"] if show_tokens else None})
        for r in rows
    ]
