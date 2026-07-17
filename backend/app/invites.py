"""User invite flow: create invite tokens, send invite emails, accept invites.

Flow:
  1. Admin (users:create permission) POST /auth/invites → generates a token,
     sends an email (if SMTP configured), returns the invite URL either way.
  2. Anyone with the token GET /auth/invites/{token} → verifies it's valid.
  3. Invitee POST /auth/invites/{token}/accept → creates their account and
     marks the invite consumed.
"""
import os
import secrets
from datetime import datetime, timedelta, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from . import db, mailer, security
from .auth import UserOut, get_current_user
from .roles import WILDCARD, get_user_permissions

router = APIRouter(prefix="/auth", tags=["auth"])

INVITE_EXPIRE_HOURS = int(os.environ.get("INVITE_EXPIRE_HOURS", "72"))

CREATE_INVITES_TABLE = """
CREATE TABLE IF NOT EXISTS invites (
    id          bigserial PRIMARY KEY,
    email       text NOT NULL,
    token       text NOT NULL UNIQUE,
    role_id     bigint REFERENCES roles(id) ON DELETE SET NULL,
    invited_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    accepted_at timestamptz,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_token_idx ON invites (token);
"""


async def ensure_schema() -> None:
    async with db.get_pool().acquire() as conn:
        await conn.execute(CREATE_INVITES_TABLE)


async def _require_users_create(current: UserOut = Depends(get_current_user)) -> UserOut:
    perms = await get_user_permissions(current.id)
    if WILDCARD in perms or "users:create" in perms:
        return current
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing permission: users:create")


# ── Request / response models ──────────────────────────────────────────────────

class InviteCreate(BaseModel):
    email: str
    role_id: int | None = None


class InviteOut(BaseModel):
    id: int
    email: str
    role_id: int | None
    role_name: str | None
    invited_by_name: str | None
    expires_at: datetime
    created_at: datetime
    invite_url: str
    email_sent: bool


class InviteInfo(BaseModel):
    """Public info returned when an invitee loads their invite link."""
    email: str
    role_name: str | None
    expires_at: datetime


class AcceptInvite(BaseModel):
    name: str
    surname: str
    password: str


class AcceptedOut(BaseModel):
    message: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _invite_url(request: Request, token: str) -> str:
    """Build the frontend URL the invitee opens to set their password."""
    base = os.environ.get("OAUTH_REDIRECT_BASE_URL", str(request.base_url).rstrip("/"))
    return f"{base}/invite/{token}"


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: InviteCreate,
    request: Request,
    current: UserOut = Depends(_require_users_create),
) -> InviteOut:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_EXPIRE_HOURS)

    pool = db.get_pool()

    # Validate role exists if provided.
    role_name: str | None = None
    if body.role_id is not None:
        row = await pool.fetchrow("SELECT name FROM roles WHERE id = $1", body.role_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
        role_name = row["name"]

    # Reject if a non-expired, unaccepted invite already exists for this email.
    existing = await pool.fetchval(
        """
        SELECT id FROM invites
        WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()
        """,
        body.email.lower(),
    )
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A pending invite already exists for this email address",
        )

    row = await pool.fetchrow(
        """
        INSERT INTO invites (email, token, role_id, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, email, role_id, invited_by, expires_at, created_at
        """,
        body.email.lower(),
        token,
        body.role_id,
        current.id,
        expires_at,
    )

    invite_url = _invite_url(request, token)
    email_sent = False

    if mailer.is_configured():
        subject = f"You've been invited to {os.environ.get('SMTP_FROM_NAME', 'the app')}"
        text_body = (
            f"Hi,\n\n"
            f"You've been invited to join. Click the link below to set your password "
            f"and activate your account (expires in {INVITE_EXPIRE_HOURS} hours):\n\n"
            f"{invite_url}\n\n"
            f"If you weren't expecting this invite, you can ignore this email."
        )
        html_body = (
            f"<p>Hi,</p>"
            f"<p>You've been invited to join. Click the link below to set your password "
            f"and activate your account (expires in {INVITE_EXPIRE_HOURS} hours):</p>"
            f'<p><a href="{invite_url}">{invite_url}</a></p>'
            f"<p>If you weren't expecting this invite, you can ignore this email.</p>"
        )
        email_sent = await run_in_threadpool(
            mailer.send_email, body.email, subject, text_body, html=html_body
        )

    return InviteOut(
        id=row["id"],
        email=row["email"],
        role_id=row["role_id"],
        role_name=role_name,
        invited_by_name=f"{current.name} {current.surname}".strip(),
        expires_at=row["expires_at"],
        created_at=row["created_at"],
        invite_url=invite_url,
        email_sent=email_sent,
    )


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    request: Request,
    current: UserOut = Depends(_require_users_create),
) -> list[InviteOut]:
    rows = await db.get_pool().fetch(
        """
        SELECT i.id, i.email, i.token, i.role_id, i.invited_by, i.accepted_at,
               i.expires_at, i.created_at,
               r.name AS role_name,
               u.name AS inviter_name, u.surname AS inviter_surname
        FROM invites i
        LEFT JOIN roles r ON r.id = i.role_id
        LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.accepted_at IS NULL AND i.expires_at > now()
        ORDER BY i.created_at DESC
        """
    )
    return [
        InviteOut(
            id=r["id"],
            email=r["email"],
            role_id=r["role_id"],
            role_name=r["role_name"],
            invited_by_name=f"{r['inviter_name'] or ''} {r['inviter_surname'] or ''}".strip() or None,
            expires_at=r["expires_at"],
            created_at=r["created_at"],
            invite_url=_invite_url(request, r["token"]),
            email_sent=False,
        )
        for r in rows
    ]


@router.get("/invites/{token}", response_model=InviteInfo)
async def get_invite(token: str) -> InviteInfo:
    """Public endpoint — returns invite metadata so the accept page can greet the invitee."""
    row = await db.get_pool().fetchrow(
        """
        SELECT i.email, i.expires_at, r.name AS role_name
        FROM invites i
        LEFT JOIN roles r ON r.id = i.role_id
        WHERE i.token = $1
        """,
        token,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_410_GONE, "Invite has expired")
    if await db.get_pool().fetchval(
        "SELECT accepted_at FROM invites WHERE token = $1", token
    ):
        raise HTTPException(status.HTTP_410_GONE, "Invite has already been used")
    return InviteInfo(email=row["email"], role_name=row["role_name"], expires_at=row["expires_at"])


@router.post("/invites/{token}/accept", response_model=AcceptedOut)
async def accept_invite(token: str, body: AcceptInvite) -> AcceptedOut:
    """Public endpoint — validates the token and creates the user account."""
    pool = db.get_pool()

    row = await pool.fetchrow(
        "SELECT id, email, role_id, accepted_at, expires_at FROM invites WHERE token = $1",
        token,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    if row["accepted_at"] is not None:
        raise HTTPException(status.HTTP_410_GONE, "Invite has already been used")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_410_GONE, "Invite has expired")

    if not body.name.strip() or not body.surname.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name and surname are required")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password must be at least 8 characters")

    pw_hash = security.hash_password(body.password)

    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                user = await conn.fetchrow(
                    """
                    INSERT INTO users (name, surname, email, password_hash, role_id)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                    """,
                    body.name.strip(),
                    body.surname.strip(),
                    row["email"],
                    pw_hash,
                    row["role_id"],
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "An account with this email already exists",
                )

            await conn.execute(
                "UPDATE invites SET accepted_at = now() WHERE id = $1",
                row["id"],
            )

    return AcceptedOut(message="Account created. You can now log in.")
