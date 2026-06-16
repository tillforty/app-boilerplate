"""Authentication: users table, login (JWT), and the current-user dependency.

Registration is intentionally not exposed. The single initial user is seeded on
startup from the SEED_USER_* environment variables (see ensure_schema_and_seed).
The canonical DDL also lives in migrations/0002_users.sql.
"""
import os

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from . import db, security

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


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProfileUpdate(BaseModel):
    name: str | None = None
    surname: str | None = None
    email: str | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


async def ensure_schema_and_seed() -> None:
    """Create the users table if missing and seed the initial user once."""
    pool = db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(CREATE_USERS_TABLE)

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
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    row = await db.get_pool().fetchrow(
        "SELECT id, name, surname, email FROM users WHERE id = $1",
        int(payload["sub"]),
    )
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return UserOut(**dict(row))


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
async def login(body: LoginRequest, response: Response) -> LoginResponse:
    row = await db.get_pool().fetchrow(
        "SELECT id, name, surname, email, password_hash FROM users WHERE email = $1",
        body.email,
    )
    if row is None or not security.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

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
    row = await db.get_pool().fetchrow(
        f"UPDATE users SET {sets} WHERE id = $1 RETURNING id, name, surname, email",
        current.id,
        *fields.values(),
    )
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


@router.get("/users", response_model=list[UserOut])
async def list_users(_: UserOut = Depends(get_current_user)) -> list[UserOut]:
    rows = await db.get_pool().fetch(
        "SELECT id, name, surname, email FROM users ORDER BY id"
    )
    return [UserOut(**dict(r)) for r in rows]
