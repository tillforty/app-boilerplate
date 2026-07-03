"""AI endpoint: a thin, RBAC-guarded wrapper over the operating-agent LLM.

Demonstrates how to expose the `llm` helper as a real endpoint. Guarded by the
'ai:use' permission and returns 503 when no operating-agent API key is set, so
the boilerplate runs without an LLM configured.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from . import llm
from .auth import UserOut
from .roles import require_permission

router = APIRouter(prefix="/ai", tags=["ai"])


class AskRequest(BaseModel):
    prompt: str = Field(min_length=1)
    system: str | None = None


class AskResponse(BaseModel):
    answer: str


def _configured() -> bool:
    return bool(os.environ.get("OPERATING_AGENT_API_KEY"))


@router.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, _: UserOut = Depends(require_permission("ai:use"))) -> AskResponse:
    if not _configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "LLM is not configured (set OPERATING_AGENT_API_KEY)",
        )
    messages: list[dict] = []
    if body.system:
        messages.append({"role": "system", "content": body.system})
    messages.append({"role": "user", "content": body.prompt})
    try:
        answer = await llm.complete(messages)
    except Exception as exc:  # noqa: BLE001 - surface provider errors as 502
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"LLM request failed: {exc}")
    return AskResponse(answer=answer)
