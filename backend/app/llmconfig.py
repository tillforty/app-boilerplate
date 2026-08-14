"""Runtime LLM configuration: provider credentials + per-function model bindings.

Design (best-practice, mirrors the app's other runtime config):
  - **Connections** (`llm_credentials`): a named credential = provider + label +
    auth mode (API key or Claude subscription) + optional base_url + default
    model. The API KEY itself is stored ENCRYPTED in
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
# Capabilities: "chat" (completions), "embeddings", and "coding_agent" (a
# headless coding CLI — Codex for OpenAI, Claude Code for Anthropic). Anthropic
# has no embeddings endpoint, so the embeddings function only accepts OpenAI.
#
# Auth modes: "api_key" (a provider API key, billed per token) and
# "subscription" (an OAuth token from a Claude plan). Only Claude Code reads a
# subscription token from the environment (CLAUDE_CODE_OAUTH_TOKEN, minted by
# `claude setup-token`), so subscription connections are offered for Anthropic
# only and can be bound to coding-agent functions only — the Messages API used
# by chat/embeddings needs a real API key.
PROVIDERS: list[dict] = [
    {
        "key": "openai",
        "label": "OpenAI",
        "capabilities": ["chat", "embeddings", "coding_agent"],
        "supports_base_url": True,
        "auth_modes": ["api_key"],
        "subscription_capabilities": [],
        "chat_models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
        "embedding_models": ["text-embedding-3-small", "text-embedding-3-large"],
        "coding_models": ["gpt-5-codex", "gpt-5", "o4-mini"],
    },
    {
        "key": "anthropic",
        "label": "Claude (Anthropic)",
        "capabilities": ["chat", "coding_agent"],
        "supports_base_url": False,
        "auth_modes": ["api_key", "subscription"],
        "subscription_capabilities": ["coding_agent"],
        "chat_models": [
            "claude-opus-5",
            "claude-opus-4-8",
            "claude-sonnet-5",
            "claude-haiku-4-5",
            "claude-fable-5",
        ],
        "embedding_models": [],
        "coding_models": ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    },
]
_PROVIDER_KEYS = {p["key"] for p in PROVIDERS}
_PROVIDER_CAPS = {p["key"]: set(p["capabilities"]) for p in PROVIDERS}
_PROVIDER_AUTH_MODES = {p["key"]: set(p["auth_modes"]) for p in PROVIDERS}
_SUBSCRIPTION_CAPS = {p["key"]: set(p["subscription_capabilities"]) for p in PROVIDERS}
AUTH_MODES = ("api_key", "subscription")

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
    {
        "key": "development_agent",
        "label": "Development agent",
        "capability": "coding_agent",
        "description": (
            "Builds Development › Agent jobs into a pull request. The provider "
            "picks the CLI: Claude (Anthropic) → Claude Code, OpenAI → Codex. "
            "Leave the model blank to use the CLI's own default."
        ),
    },
]
_FUNCTION_KEYS = {f["key"] for f in AI_FUNCTIONS}
_FUNCTION_CAP = {f["key"]: f["capability"] for f in AI_FUNCTIONS}


def _vault_name(credential_id: int) -> str:
    return f"llm_credential:{credential_id}"


def _flow_vault_name(flow_id: int) -> str:
    return f"llm_token_flow:{flow_id}"


async def ensure_schema() -> None:
    """Idempotent mirror of migrations/0011_llm.sql + 0015_llm_auth_mode.sql."""
    async with db.get_pool().acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS llm_credentials (
                id            bigserial PRIMARY KEY,
                provider      text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
                label         text NOT NULL,
                base_url      text,
                default_model text,
                auth_mode     text NOT NULL DEFAULT 'api_key',
                has_key       boolean NOT NULL DEFAULT false,
                created_at    timestamptz NOT NULL DEFAULT now(),
                updated_at    timestamptz NOT NULL DEFAULT now()
            );
            -- Added after 0011; present here so a code deploy works before migrations run.
            ALTER TABLE llm_credentials
                ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'api_key';
            ALTER TABLE llm_credentials
                DROP CONSTRAINT IF EXISTS llm_credentials_auth_mode_check;
            ALTER TABLE llm_credentials
                ADD CONSTRAINT llm_credentials_auth_mode_check
                CHECK (auth_mode IN ('api_key', 'subscription'));
            CREATE TABLE IF NOT EXISTS ai_function_bindings (
                function_key  text PRIMARY KEY,
                credential_id bigint REFERENCES llm_credentials(id) ON DELETE SET NULL,
                model         text,
                updated_at    timestamptz NOT NULL DEFAULT now()
            );
            -- Canonical DDL: migrations/0016_llm_token_flows.sql.
            CREATE TABLE IF NOT EXISTS llm_token_flows (
                id         bigserial PRIMARY KEY,
                state      text NOT NULL DEFAULT 'requested'
                           CHECK (state IN ('requested', 'awaiting_code',
                                            'code_submitted', 'done', 'failed')),
                url        text,
                code       text,
                error      text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS llm_token_flows_state_idx
                ON llm_token_flows (state, created_at);
            """
        )


# ── Resolution (consumed by llm.py) ──────────────────────────────────────────
@dataclass
class ResolvedModel:
    provider: str
    api_key: str
    base_url: str | None
    model: str | None
    auth_mode: str = "api_key"


async def resolve(function_key: str) -> ResolvedModel | None:
    """Effective provider/key/model for a function, or None when unbound / keyless.
    llm.py falls back to environment variables when this returns None."""
    row = await db.get_pool().fetchrow(
        """
        SELECT c.id, c.provider, c.base_url, c.default_model, c.has_key, c.auth_mode, b.model
        FROM ai_function_bindings b
        JOIN llm_credentials c ON c.id = b.credential_id
        WHERE b.function_key = $1
        """,
        function_key,
    )
    if row is None or not row["has_key"]:
        return None
    # A subscription token only drives the coding CLIs; the SDK paths below this
    # (chat/embeddings) need a real API key, so treat it as unbound for them.
    # set_function_binding rejects such a binding, but an older row may predate it.
    if row["auth_mode"] == "subscription" and _FUNCTION_CAP.get(function_key) not in (
        _SUBSCRIPTION_CAPS.get(row["provider"], set())
    ):
        return None
    api_key = await vault.get_secret(_vault_name(row["id"]))
    if not api_key:
        return None
    return ResolvedModel(
        provider=row["provider"],
        api_key=api_key,
        base_url=row["base_url"],
        model=row["model"] or row["default_model"],
        auth_mode=row["auth_mode"],
    )


# ── API models ───────────────────────────────────────────────────────────────
class Credential(BaseModel):
    id: int
    provider: str
    label: str
    base_url: str | None
    default_model: str | None
    # 'api_key' or 'subscription'; decides which env var the coding CLI gets.
    auth_mode: str
    has_key: bool


class CredentialCreate(BaseModel):
    provider: str
    label: str = Field(min_length=1, max_length=120)
    base_url: str | None = None
    default_model: str | None = None
    auth_mode: str = "api_key"
    # The secret itself: an API key, or a subscription OAuth token when
    # auth_mode is 'subscription'. Either way it goes straight to the vault.
    # Exactly one of api_key / token_flow_id is required.
    api_key: str | None = None
    # A completed browser sign-in flow whose minted token is already in the vault.
    token_flow_id: int | None = None


class CredentialUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = None
    default_model: str | None = None
    # When present and non-empty, rotates the vault-stored secret; blank/None keeps it.
    api_key: str | None = None
    # Or rotate it from a finished browser sign-in.
    token_flow_id: int | None = None


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
        auth_mode=row["auth_mode"],
        has_key=row["has_key"],
    )


class TokenFlow(BaseModel):
    """A browser sign-in in progress. The minted token is never returned here —
    it stays in the vault until a credential claims it via token_flow_id."""

    id: int
    state: str
    url: str | None
    error: str | None


class TokenFlowCode(BaseModel):
    code: str = Field(min_length=1, max_length=2048)


async def _claim_flow_token(flow_id: int) -> str:
    """The token a finished browser sign-in minted, from the vault."""
    flow = await db.get_pool().fetchrow(
        "SELECT state FROM llm_token_flows WHERE id = $1", flow_id
    )
    if flow is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sign-in flow not found.")
    if flow["state"] != "done":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "The browser sign-in hasn't finished yet."
        )
    token = await vault.get_secret(_flow_vault_name(flow_id))
    if not token:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "The signed-in token is no longer available."
        )
    return token


async def _discard_flow(conn, flow_id: int) -> None:
    """The flow's copy of the token has served its purpose."""
    await conn.execute(
        "DELETE FROM vault_secrets WHERE name = $1", _flow_vault_name(flow_id)
    )
    await conn.execute("DELETE FROM llm_token_flows WHERE id = $1", flow_id)


async def _resolve_new_secret(body: CredentialCreate) -> str:
    """The secret a new credential should store: either the pasted key, or the
    token minted by a completed browser sign-in flow."""
    typed = (body.api_key or "").strip()
    if typed and body.token_flow_id is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Pass either api_key or token_flow_id, not both."
        )
    if typed:
        return typed
    if body.token_flow_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An api_key or token_flow_id is required.")
    return await _claim_flow_token(body.token_flow_id)


# ── Endpoints (all admin-gated: ai:manage) ───────────────────────────────────
@router.post("/subscription/flows", response_model=TokenFlow, status_code=status.HTTP_201_CREATED)
async def start_token_flow(_: UserOut = Depends(require_permission("ai:manage"))) -> TokenFlow:
    """Ask the agent runner to start `claude setup-token` and report its URL.

    The API image has no `claude` CLI, so this only queues the request; poll the
    GET endpoint until state is 'awaiting_code' and a url is present.
    """
    row = await db.get_pool().fetchrow(
        "INSERT INTO llm_token_flows (state) VALUES ('requested') RETURNING id, state, url, error"
    )
    return TokenFlow(**dict(row))


@router.get("/subscription/flows/{flow_id}", response_model=TokenFlow)
async def get_token_flow(
    flow_id: int, _: UserOut = Depends(require_permission("ai:manage"))
) -> TokenFlow:
    row = await db.get_pool().fetchrow(
        "SELECT id, state, url, error FROM llm_token_flows WHERE id = $1", flow_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sign-in flow not found")
    return TokenFlow(**dict(row))


@router.post("/subscription/flows/{flow_id}/code", response_model=TokenFlow)
async def submit_token_flow_code(
    flow_id: int,
    body: TokenFlowCode,
    _: UserOut = Depends(require_permission("ai:manage")),
) -> TokenFlow:
    """Hand the browser's code back to the waiting CLI process."""
    row = await db.get_pool().fetchrow(
        """
        UPDATE llm_token_flows
        SET code = $2, state = 'code_submitted', updated_at = now()
        WHERE id = $1 AND state = 'awaiting_code'
        RETURNING id, state, url, error
        """,
        flow_id,
        body.code.strip(),
    )
    if row is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This sign-in isn't waiting for a code — start a new one.",
        )
    return TokenFlow(**dict(row))


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
    if body.auth_mode not in _PROVIDER_AUTH_MODES[body.provider]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Provider '{body.provider}' doesn't support '{body.auth_mode}' authentication.",
        )
    secret = await _resolve_new_secret(body)
    base_url = (body.base_url or "").strip() or None
    default_model = (body.default_model or "").strip() or None
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO llm_credentials
                    (provider, label, base_url, default_model, auth_mode, has_key)
                VALUES ($1, $2, $3, $4, $5, true)
                RETURNING *
                """,
                body.provider,
                body.label.strip(),
                base_url,
                default_model,
                body.auth_mode,
            )
            # Secret is written to the encrypted vault, keyed by the new row id.
            await vault.set_secret(_vault_name(row["id"]), secret)
            if body.token_flow_id is not None:
                await _discard_flow(conn, body.token_flow_id)
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
    if body.token_flow_id is not None:
        if new_key:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Pass either api_key or token_flow_id, not both."
            )
        new_key = await _claim_flow_token(body.token_flow_id)
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
            if body.token_flow_id is not None:
                await _discard_flow(conn, body.token_flow_id)
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
        return {"ok": False, "error": "No credential stored for this connection."}
    ok, error = await llm.test_credential(
        provider=row["provider"],
        api_key=api_key,
        base_url=row["base_url"],
        model=row["default_model"],
        auth_mode=row["auth_mode"],
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
            "SELECT provider, auth_mode FROM llm_credentials WHERE id = $1", credential_id
        )
        if cred is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Credential not found")
        # Enforce capability: embeddings functions require an embeddings-capable provider.
        if fn["capability"] not in _PROVIDER_CAPS.get(cred["provider"], set()):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Provider '{cred['provider']}' can't serve the '{fn['capability']}' capability.",
            )
        # A subscription token is only usable by the coding CLIs, not the SDKs.
        if cred["auth_mode"] == "subscription" and fn["capability"] not in _SUBSCRIPTION_CAPS.get(
            cred["provider"], set()
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Subscription connections can't serve the '{fn['capability']}' capability — "
                "use an API key connection.",
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
