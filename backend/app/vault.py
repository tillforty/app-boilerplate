"""Encrypted secret store backed by Postgres pgcrypto.

Secrets are encrypted at rest with pgp_sym_encrypt using VAULT_KEY (symmetric).
Login passwords are NOT stored here — those are one-way bcrypt hashes in `users`.
This vault is for secrets that must be read back (3rd-party API tokens, etc.).
Canonical DDL: migrations/0001_extensions.sql + migrations/0004_vault.sql.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import db
from .auth import UserOut, get_current_user

VAULT_KEY = os.environ.get("VAULT_KEY", "")

router = APIRouter(prefix="/vault", tags=["vault"])

CREATE_SCHEMA = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS vault_secrets (
    name       text PRIMARY KEY,
    value      bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
"""


async def ensure_schema() -> None:
    async with db.get_pool().acquire() as conn:
        await conn.execute(CREATE_SCHEMA)


async def set_secret(name: str, value: str) -> None:
    await db.get_pool().execute(
        """
        INSERT INTO vault_secrets (name, value)
        VALUES ($1, pgp_sym_encrypt($2, $3))
        ON CONFLICT (name)
        DO UPDATE SET value = pgp_sym_encrypt($2, $3), updated_at = now()
        """,
        name,
        value,
        VAULT_KEY,
    )


async def get_secret(name: str) -> str | None:
    return await db.get_pool().fetchval(
        "SELECT pgp_sym_decrypt(value, $2) FROM vault_secrets WHERE name = $1",
        name,
        VAULT_KEY,
    )


class SecretIn(BaseModel):
    name: str
    value: str


class SecretOut(BaseModel):
    name: str
    value: str


@router.put("", status_code=status.HTTP_204_NO_CONTENT)
async def put_secret(body: SecretIn, _: UserOut = Depends(get_current_user)) -> None:
    await set_secret(body.name, body.value)


@router.get("/{name}", response_model=SecretOut)
async def read_secret(name: str, _: UserOut = Depends(get_current_user)) -> SecretOut:
    value = await get_secret(name)
    if value is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Secret not found")
    return SecretOut(name=name, value=value)
