"""Runtime LLM configuration: provider credentials + per-function model bindings.

Design (best-practice, mirrors the app's other runtime config):
  - **Connections** (`llm_credentials`): a named credential = provider + label +
    optional base_url + default model. The API KEY itself is stored ENCRYPTED in
    the pgcrypto vault (vault.set_secret) under 'llm_credential:{id}', never in
    this table and never returned to the browser.
  - **Function bindings** (`ai_function_bindings`): each app AI function
    (registry AI_FUNCTIONS) points at one connection + a chosen model.
  - `resolve(function_key)` returns the effective provider/key/model for a
    function; llm.py falls back to env vars when a function is unbound.

Secrets stay out of every response — only `has_key` / masked hints are exposed.
"""
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from . import db, vault
from .auth import UserOut
from .roles import require_permission

router = APIRouter(prefix="/llm", tags=["llm"])

# ── Provider + model catalog (drives the UI selects) ─────────────────────────
# Capabilities: "chat" (completions) and "embeddings". Anthropic has no
# embeddings endpoint, so the embeddings function only accepts OpenAI providers.
PROVIDERS: list[dict] = [
    {
        "key": "openai",
        "label": "OpenAI",
        "capabilities": ["chat", "embeddings"],
        "supports_base_url": True,
        "chat_models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
        "embedding_models": ["text-embedding-3-small", "text-embedding-3-large"],
    },
    {
        "key": "anthropic",
        "label": "Claude (Anthropic)",
        "capabilities": ["chat"],
        "supports_base_url": False,
        "chat_models": [
            "claude-opus-4-8",
            "claude-sonnet-5",
            "claude-haiku-4-5",
            "claude-fable-5",
        ],
        "embedding_models": [],
    },
]
_PROVIDER_KEYS = {p["key"] for p in PROVIDERS}
_PROVIDER_CAPS = {p["key"]: set(p["capabilities"]) for p in PROVIDERS}

# ── Registry of app functions that can use an LLM ────────────────────────────
# Add an entry here to expose a new bindable AI function in the UI. `capability`
# constrains which providers/models are selectable for it.
AI_FUNCTIONS: list[dict] = [
    {
        "key": "operating_agent",
        "label": "Operating agent",
        "capability": "chat",
        "description": "Chat / completions used by the Ask-AI endpoint and assistant features.",
    },
    {
        "key": "embeddings",
        "label": "Semantic search embeddings",
        "capability": "embeddings",
        "description": "Vectorizes records for pgvector semantic search. OpenAI-compatible only.",
    },
]
_FUNCTION_KEYS = {f["key"] for f in AI_FUNCTIONS}
_FUNCTION_CAP = {f["key"]: f["capability"] for f in AI_FUNCTIONS}


def _vault_name(credential_id: int) -> str:
    return f"llm_credential:{credential_id}"


async def ensure_schema() -> None:
    """Idempotent mirror of migrations/0011_llm.sql."""
    async with db.get_pool().acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS llm_credentials (
                id            bigserial PRIMARY KEY,
                provider      text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
                label         text NOT NULL,
                base_url      text,
                default_model text,
                has_key       boolean NOT NULL DEFAULT false,
                created_at    timestamptz NOT NULL DEFAULT now(),
                updated_at    timestamptz NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS ai_function_bindings (
                function_key  text PRIMARY KEY,
                credential_id bigint REFERENCES llm_credentials(id) ON DELETE SET NULL,
                model         text,
                updated_at    timestamptz NOT NULL DEFAULT now()
            );
            """
        )


# ── Resolution (consumed by llm.py) ──────────────────────────────────────────
@dataclass
class ResolvedModel:
    provider: str
    api_key: str
    base_url: str | None
    model: str | None


async def resolve(function_key: str) -> ResolvedModel | None:
    """Effective provider/key/model for a function, or None when unbound / keyless.
    llm.py falls back to environment variables when this returns None."""
    row = await db.get_pool().fetchrow(
        """
        SELECT c.id, c.provider, c.base_url, c.default_model, c.has_key, b.model
        FROM ai_function_bindings b
        JOIN llm_credentials c ON c.id = b.credential_id
        WHERE b.function_key = $1
        """,
        function_key,
    )
    if row is None or not row["has_key"]:
        return None
    api_key = await vault.get_secret(_vault_name(row["id"]))
    if not api_key:
        return None
    return ResolvedModel(
        provider=row["provider"],
        api_key=api_key,
        base_url=row["base_url"],
        model=row["model"] or row["default_model"],
    )


# ── API models ───────────────────────────────────────────────────────────────
class Credential(BaseModel):
    id: int
    provider: str
    label: str
    base_url: str | None
    default_model: str | None
    has_key: bool


class CredentialCreate(BaseModel):
    provider: str
    label: str = Field(min_length=1, max_length=120)
    base_url: str | None = None
    default_model: str | None = None
    api_key: str = Field(min_length=1)


class CredentialUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = None
    default_model: str | None = None
    # When present and non-empty, rotates the vault-stored key; blank/None keeps it.
    api_key: str | None = None


class FunctionBinding(BaseModel):
    key: str
    label: str
    description: str
    capability: str
    credential_id: int | None
    model: str | None


class BindingUpdate(BaseModel):
    credential_id: int | None
    model: str | None = None


def _row_to_credential(row) -> Credential:
    return Credential(
        id=row["id"],
        provider=row["provider"],
        label=row["label"],
        base_url=row["base_url"],
        default_model=row["default_model"],
        has_key=row["has_key"],
    )


# ── Endpoints (all admin-gated: ai:manage) ───────────────────────────────────
@router.get("/providers")
async def get_providers(_: UserOut = Depends(require_permission("ai:manage"))) -> dict:
    """Static provider + model catalog for the UI selects."""
    return {"providers": PROVIDERS}


@router.get("/credentials", response_model=list[Credential])
async def list_credentials(
    _: UserOut = Depends(require_permission("ai:manage")),
) -> list[Credential]:
    rows = await db.get_pool().fetch(
        "SELECT * FROM llm_credentials ORDER BY created_at DESC, id DESC"
    )
    return [_row_to_credential(r) for r in rows]


@router.post("/credentials", response_model=Credential, status_code=status.HTTP_201_CREATED)
async def create_credential(
    body: CredentialCreate, _: UserOut = Depends(require_permission("ai:manage"))
) -> Credential:
    if body.provider not in _PROVIDER_KEYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown provider: {body.provider}")
    base_url = (body.base_url or "").strip() or None
    default_model = (body.default_model or "").strip() or None
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO llm_credentials (provider, label, base_url, default_model, has_key)
                VALUES ($1, $2, $3, $4, true)
                RETURNING *
                """,
                body.provider,
                body.label.strip(),
                base_url,
                default_model,
            )
            # Key is written to the encrypted vault, keyed by the new row id.
            await vault.set_secret(_vault_name(row["id"]), body.api_key)
    return _row_to_credential(row)


@router.patch("/credentials/{credential_id}", response_model=Credential)
async def update_credential(
    credential_id: int,
    body: CredentialUpdate,
    _: UserOut = Depends(require_permission("ai:manage")),
) -> Credential:
    existing = await db.get_pool().fetchrow(
        "SELECT * FROM llm_credentials WHERE id = $1", credential_id
    )
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")

    new_key = (body.api_key or "").strip()
    label = body.label.strip() if body.label is not None else existing["label"]
    base_url = existing["base_url"] if body.base_url is None else (body.base_url.strip() or None)
    default_model = (
        existing["default_model"]
        if body.default_model is None
        else (body.default_model.strip() or None)
    )
    has_key = existing["has_key"] or bool(new_key)
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE llm_credentials
                SET label = $2, base_url = $3, default_model = $4, has_key = $5, updated_at = now()
                WHERE id = $1
                RETURNING *
                """,
                credential_id,
                label,
                base_url,
                default_model,
                has_key,
            )
            if new_key:
                await vault.set_secret(_vault_name(credential_id), new_key)
    return _row_to_credential(row)


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    credential_id: int, _: UserOut = Depends(require_permission("ai:manage"))
) -> None:
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            deleted = await conn.fetchval(
                "DELETE FROM llm_credentials WHERE id = $1 RETURNING id", credential_id
            )
            if deleted is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")
            # Bindings referencing it are set NULL by the FK; purge the vault key.
            await conn.execute("DELETE FROM vault_secrets WHERE name = $1", _vault_name(credential_id))


@router.post("/credentials/{credential_id}/test")
async def test_credential(
    credential_id: int, _: UserOut = Depends(require_permission("ai:manage"))
) -> dict:
    """Minimal live check that the stored key works. Returns {ok, error?}."""
    from . import llm  # lazy: llm imports llmconfig

    row = await db.get_pool().fetchrow(
        "SELECT * FROM llm_credentials WHERE id = $1", credential_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credential not found")
    api_key = await vault.get_secret(_vault_name(credential_id))
    if not api_key:
        return {"ok": False, "error": "No API key stored for this credential."}
    ok, error = await llm.test_credential(
        provider=row["provider"],
        api_key=api_key,
        base_url=row["base_url"],
        model=row["default_model"],
    )
    return {"ok": ok, "error": error}


@router.get("/functions", response_model=list[FunctionBinding])
async def list_functions(
    _: UserOut = Depends(require_permission("ai:manage")),
) -> list[FunctionBinding]:
    rows = await db.get_pool().fetch("SELECT * FROM ai_function_bindings")
    bindings = {r["function_key"]: r for r in rows}
    result: list[FunctionBinding] = []
    for fn in AI_FUNCTIONS:
        b = bindings.get(fn["key"])
        result.append(
            FunctionBinding(
                key=fn["key"],
                label=fn["label"],
                description=fn["description"],
                capability=fn["capability"],
                credential_id=b["credential_id"] if b else None,
                model=b["model"] if b else None,
            )
        )
    return result


@router.put("/functions/{function_key}", response_model=FunctionBinding)
async def set_function_binding(
    function_key: str,
    body: BindingUpdate,
    _: UserOut = Depends(require_permission("ai:manage")),
) -> FunctionBinding:
    if function_key not in _FUNCTION_KEYS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown AI function")
    fn = next(f for f in AI_FUNCTIONS if f["key"] == function_key)

    credential_id = body.credential_id
    model = (body.model or "").strip() or None
    if credential_id is not None:
        cred = await db.get_pool().fetchrow(
            "SELECT provider FROM llm_credentials WHERE id = $1", credential_id
        )
        if cred is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Credential not found")
        # Enforce capability: embeddings functions require an embeddings-capable provider.
        if fn["capability"] not in _PROVIDER_CAPS.get(cred["provider"], set()):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Provider '{cred['provider']}' can't serve the '{fn['capability']}' capability.",
            )
    await db.get_pool().execute(
        """
        INSERT INTO ai_function_bindings (function_key, credential_id, model, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (function_key)
        DO UPDATE SET credential_id = $2, model = $3, updated_at = now()
        """,
        function_key,
        credential_id,
        model,
    )
    return FunctionBinding(
        key=fn["key"],
        label=fn["label"],
        description=fn["description"],
        capability=fn["capability"],
        credential_id=credential_id,
        model=model,
    )
