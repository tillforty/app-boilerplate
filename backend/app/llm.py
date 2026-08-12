"""LLM client: text embeddings + operating-agent chat completions.

Provider-aware. Each app AI function (see llmconfig.AI_FUNCTIONS) can be bound at
runtime to a saved provider credential; when unbound, these helpers fall back to
the environment variables (backward compatible with the original OpenAI-only
setup). Embeddings are OpenAI-compatible only — Anthropic has no embeddings API.

  operating_agent → OpenAI chat completions OR Anthropic messages
  embeddings      → OpenAI embeddings (or any OpenAI-compatible endpoint)
"""
import os
from functools import lru_cache

from openai import AsyncOpenAI

from . import llmconfig

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "1536"))
OPERATING_AGENT_MODEL = os.environ.get("OPERATING_AGENT_MODEL", "gpt-4o")


# ── Cached provider clients (keyed by key+base_url so rotations pick up) ──────
@lru_cache(maxsize=8)
def _openai_client(api_key: str, base_url: str | None) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=api_key or "", base_url=base_url or None)


@lru_cache(maxsize=8)
def _anthropic_client(api_key: str, base_url: str | None):
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=api_key or "", base_url=base_url or None)


# ── Configuration checks (used by ai.py / customers.py to 503 gracefully) ─────
async def is_agent_configured() -> bool:
    if await llmconfig.resolve("operating_agent") is not None:
        return True
    return bool(os.environ.get("OPERATING_AGENT_API_KEY"))


async def is_embeddings_configured() -> bool:
    if await llmconfig.resolve("embeddings") is not None:
        return True
    return bool(os.environ.get("EMBEDDING_API_KEY"))


# ── Embeddings (OpenAI-compatible only) ──────────────────────────────────────
async def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, order preserved."""
    resolved = await llmconfig.resolve("embeddings")
    if resolved is not None:
        # embeddings functions are constrained to OpenAI-capable providers.
        client = _openai_client(resolved.api_key, resolved.base_url)
        model = resolved.model or EMBEDDING_MODEL
    else:
        client = _openai_client(
            os.environ.get("EMBEDDING_API_KEY", ""), os.environ.get("EMBEDDING_BASE_URL") or None
        )
        model = EMBEDDING_MODEL
    res = await client.embeddings.create(model=model, input=texts)
    return [d.embedding for d in res.data]


async def embed_one(text: str) -> list[float]:
    """Embed a single string. Convenience wrapper over embed()."""
    return (await embed([text]))[0]


# ── Chat completions (OpenAI or Anthropic) ───────────────────────────────────
def _split_system(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """Anthropic takes system as a top-level param, not a message role. Pull any
    system messages out and return (system_text, non_system_messages)."""
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    return ("\n\n".join(system_parts) or None, rest)


async def complete(
    messages: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.2,
    **kwargs,
) -> str:
    """Run a chat completion with the operating-agent model. Returns the text.

    `messages` is the OpenAI chat format, e.g.
    [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}].
    Works whether the operating-agent function is bound to OpenAI or Anthropic;
    Anthropic's differing request shape (system as a param) is handled here.
    """
    resolved = await llmconfig.resolve("operating_agent")

    if resolved is not None and resolved.provider == "anthropic":
        client = _anthropic_client(resolved.api_key, resolved.base_url)
        system_text, rest = _split_system(messages)
        max_tokens = kwargs.pop("max_tokens", 1024)
        # Drop OpenAI-only kwargs that Anthropic's SDK doesn't accept.
        for k in ("response_format", "tools", "tool_choice"):
            kwargs.pop(k, None)
        resp = await client.messages.create(
            model=model or resolved.model or "claude-opus-4-8",
            max_tokens=max_tokens,
            system=system_text or "",
            messages=rest,
            **kwargs,
        )
        return "".join(b.text for b in resp.content if b.type == "text")

    # OpenAI path (runtime binding or env fallback).
    if resolved is not None:
        client = _openai_client(resolved.api_key, resolved.base_url)
        default_model = resolved.model or OPERATING_AGENT_MODEL
    else:
        client = _openai_client(
            os.environ.get("OPERATING_AGENT_API_KEY", ""),
            os.environ.get("OPERATING_AGENT_BASE_URL") or None,
        )
        default_model = OPERATING_AGENT_MODEL
    res = await client.chat.completions.create(
        model=model or default_model,
        messages=messages,
        temperature=temperature,
        **kwargs,
    )
    return res.choices[0].message.content or ""


# ── Connection test (used by the Settings LLM tab) ───────────────────────────
async def test_credential(
    *, provider: str, api_key: str, base_url: str | None, model: str | None
) -> tuple[bool, str | None]:
    """Cheap liveness check for a stored credential. Uses the provider's Models
    API (no token cost). Returns (ok, error_message)."""
    try:
        if provider == "anthropic":
            client = _anthropic_client(api_key, base_url)
            await client.models.list()
        else:
            client = _openai_client(api_key, base_url)
            await client.models.list()
        return True, None
    except Exception as exc:  # noqa: BLE001 - surface the provider's message verbatim
        return False, str(exc)
