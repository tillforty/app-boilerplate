"""Customers — a worked example of a real CRUD domain on top of the boilerplate.

Demonstrates the full stack the boilerplate provides:
  - RBAC-guarded endpoints (customers:read/create/update/delete),
  - optional pgvector semantic search (falls back to ILIKE when embeddings or the
    embedding API key are unavailable),
  - best-effort side effects on create via the mailer + n8n helpers.

The frontend CRM page (web/src/pages/CustomersPage.tsx) is wired to this router.
Canonical DDL: migrations/0007_customers.sql.
"""
import logging
from datetime import date, datetime
from enum import Enum

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr, Field

from . import db, llm, mailer, n8n, vectors
from .auth import UserOut
from .roles import require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/customers", tags=["customers"])

_COLUMNS = "id, name, company, email, status, mrr, seats, created_at"


class CustomerStatus(str, Enum):
    active = "active"
    trial = "trial"
    churned = "churned"
    lead = "lead"


class Customer(BaseModel):
    id: int
    name: str
    company: str
    email: str
    status: CustomerStatus
    mrr: int
    seats: int
    joined: date  # derived from created_at — matches the frontend's `joined` field


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1)
    company: str = ""
    email: EmailStr
    status: CustomerStatus = CustomerStatus.lead
    mrr: int = Field(default=0, ge=0)
    seats: int = Field(default=0, ge=0)


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    company: str | None = None
    email: EmailStr | None = None
    status: CustomerStatus | None = None
    mrr: int | None = Field(default=None, ge=0)
    seats: int | None = Field(default=None, ge=0)


def _to_customer(row: asyncpg.Record) -> Customer:
    d = dict(row)
    created = d.pop("created_at")
    d["joined"] = created.date() if isinstance(created, datetime) else created
    return Customer(**d)


async def ensure_schema() -> None:
    """Warn if the deployed embedding width disagrees with EMBEDDING_DIM.

    The `customers` table is owned by migrations/0007_customers.sql, which pins
    vector(1536) — the default EMBEDDING_DIM (text-embedding-3-small). This used
    to CREATE TABLE with vector(EMBEDDING_DIM), but that only ever took effect on
    a database where the migration had not already made the table, so overriding
    EMBEDDING_DIM silently produced a column of the wrong width. Say so instead:
    an override needs its own migration."""
    deployed = await db.get_pool().fetchval(
        """
        SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        WHERE a.attrelid = 'customers'::regclass
          AND a.attname = 'embedding'
          AND NOT a.attisdropped
        """
    )
    expected = f"vector({vectors.EMBEDDING_DIM})"
    if deployed and deployed != expected:
        logger.warning(
            "customers.embedding is %s but EMBEDDING_DIM expects %s — semantic "
            "search will fail on write. Add a migration to ALTER the column.",
            deployed,
            expected,
        )


def _embed_text(c: dict) -> str:
    return f"{c['name']} {c.get('company', '')} {c.get('email', '')} {c.get('status', '')}".strip()


async def _store_embedding(customer_id: int, text: str) -> None:
    """Compute and persist an embedding. Best-effort: skips silently if no
    embedding API key is configured or the provider call fails, so customer
    writes never depend on the LLM being reachable."""
    try:
        vector = await llm.embed_one(text)
        literal = vectors.to_vector(vector)
        await db.get_pool().execute(
            "UPDATE customers SET embedding = $2::vector WHERE id = $1",
            customer_id,
            literal,
        )
    except Exception:  # noqa: BLE001 - embedding is an optional enhancement
        logger.warning(
            "Failed to store embedding for customer %s; continuing without it",
            customer_id,
            exc_info=True,
        )


async def _notify_new_customer(customer: dict) -> None:
    """Fire optional integrations when a customer is created. Both no-op when
    unconfigured (see mailer.is_configured / n8n.is_configured)."""
    await n8n.fire_webhook("customer-created", customer)
    if mailer.is_configured():
        await run_in_threadpool(
            mailer.send_email,
            customer["email"],
            "Welcome aboard",
            f"Hi {customer['name']},\n\nYour account has been created.",
        )


@router.get("", response_model=list[Customer])
async def list_customers(_: UserOut = Depends(require_permission("customers:read"))) -> list[Customer]:
    rows = await db.get_pool().fetch(
        f"SELECT {_COLUMNS} FROM customers ORDER BY id DESC"
    )
    return [_to_customer(r) for r in rows]


@router.get("/search", response_model=list[Customer])
async def search_customers(
    q: str,
    limit: int = 20,
    _: UserOut = Depends(require_permission("customers:read")),
) -> list[Customer]:
    """Semantic search over customers when embeddings are available; otherwise a
    plain case-insensitive match on name/company/email."""
    q = q.strip()
    limit = max(1, min(limit, 100))
    if not q:
        return []

    # Try a vector search first (only if the query can be embedded).
    try:
        vector = await llm.embed_one(q)
        literal = vectors.to_vector(vector)
        rows = await db.get_pool().fetch(
            f"SELECT {_COLUMNS} FROM customers "
            "WHERE embedding IS NOT NULL "
            "ORDER BY embedding <=> $1::vector LIMIT $2",
            literal,
            limit,
        )
        if rows:
            return [_to_customer(r) for r in rows]
    except Exception:  # noqa: BLE001 - fall through to keyword search
        logger.warning(
            "Vector search failed; falling back to keyword search", exc_info=True
        )

    like = f"%{q}%"
    rows = await db.get_pool().fetch(
        f"SELECT {_COLUMNS} FROM customers "
        "WHERE name ILIKE $1 OR company ILIKE $1 OR email ILIKE $1 "
        "ORDER BY id DESC LIMIT $2",
        like,
        limit,
    )
    return [_to_customer(r) for r in rows]


@router.post("", response_model=Customer, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CustomerCreate,
    background: BackgroundTasks,
    _: UserOut = Depends(require_permission("customers:create")),
) -> Customer:
    row = await db.get_pool().fetchrow(
        f"INSERT INTO customers (name, company, email, status, mrr, seats) "
        f"VALUES ($1, $2, $3, $4, $5, $6) RETURNING {_COLUMNS}",
        body.name,
        body.company,
        str(body.email),
        body.status.value,
        body.mrr,
        body.seats,
    )
    customer = _to_customer(row)
    # Best-effort enhancements/side effects, off the request's critical path.
    background.add_task(_store_embedding, customer.id, _embed_text(dict(row)))
    background.add_task(
        _notify_new_customer,
        {"id": customer.id, "name": customer.name, "email": customer.email},
    )
    return customer


@router.get("/{customer_id}", response_model=Customer)
async def get_customer(
    customer_id: int, _: UserOut = Depends(require_permission("customers:read"))
) -> Customer:
    row = await db.get_pool().fetchrow(
        f"SELECT {_COLUMNS} FROM customers WHERE id = $1", customer_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return _to_customer(row)


@router.patch("/{customer_id}", response_model=Customer)
async def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    background: BackgroundTasks,
    _: UserOut = Depends(require_permission("customers:update")),
) -> Customer:
    fields: dict = {}
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        fields[key] = value.value if isinstance(value, CustomerStatus) else value
    if "email" in fields:
        fields["email"] = str(fields["email"])
    if not fields:
        return await get_customer(customer_id, _)

    sets = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(fields))
    row = await db.get_pool().fetchrow(
        f"UPDATE customers SET {sets} WHERE id = $1 RETURNING {_COLUMNS}",
        customer_id,
        *fields.values(),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    # Identity fields changed → the embedding is stale; recompute in the background.
    if fields.keys() & {"name", "company", "email", "status"}:
        background.add_task(_store_embedding, customer_id, _embed_text(dict(row)))
    return _to_customer(row)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    customer_id: int, _: UserOut = Depends(require_permission("customers:delete"))
) -> None:
    deleted = await db.get_pool().fetchval(
        "DELETE FROM customers WHERE id = $1 RETURNING id", customer_id
    )
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
