"""LLM client: text embeddings + operating-agent chat completions.

Provider-agnostic via the OpenAI SDK — set EMBEDDING_BASE_URL / OPERATING_AGENT_
BASE_URL to target Azure, a gateway/proxy, or any OpenAI-compatible endpoint.
Two independent clients so the embedding and agent models can use different
providers and keys. Pairs with vectors.to_vector() for the pgvector store.
"""
import os
from functools import lru_cache

from openai import AsyncOpenAI

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "1536"))
OPERATING_AGENT_MODEL = os.environ.get("OPERATING_AGENT_MODEL", "gpt-4o")


@lru_cache(maxsize=1)
def _embedding_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ.get("EMBEDDING_API_KEY", ""),
        base_url=os.environ.get("EMBEDDING_BASE_URL") or None,
    )


@lru_cache(maxsize=1)
def _agent_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ.get("OPERATING_AGENT_API_KEY", ""),
        base_url=os.environ.get("OPERATING_AGENT_BASE_URL") or None,
    )


async def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, order preserved."""
    res = await _embedding_client().embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
    )
    return [d.embedding for d in res.data]


async def embed_one(text: str) -> list[float]:
    """Embed a single string. Convenience wrapper over embed()."""
    return (await embed([text]))[0]


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
    Extra kwargs (max_tokens, tools, response_format, …) pass straight through.
    """
    res = await _agent_client().chat.completions.create(
        model=model or OPERATING_AGENT_MODEL,
        messages=messages,
        temperature=temperature,
        **kwargs,
    )
    return res.choices[0].message.content or ""
