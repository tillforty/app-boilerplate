"""Operations API — the workflow-automation side of the app.

Today that is the n8n execution feed shown in Settings › Operations: what ran,
whether it succeeded, and how long it took. Reads go through n8n's public REST
API (see n8n.py); nothing here can start, stop or delete a run.

Admin-gated (roles:manage), same as the other Settings pages. When n8n isn't
wired up the frontend renders a setup checklist built from GET /operations/setup.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from . import n8n
from .auth import UserOut
from .roles import require_permission

router = APIRouter(prefix="/operations", tags=["operations"])


class OpsSetupStatus(BaseModel):
    """Per-requirement flags driving the Operations setup checklist."""

    base_url_configured: bool
    api_key_configured: bool
    api_configured: bool
    ui_url: str | None


class Execution(BaseModel):
    id: str
    workflow_id: str | None = None
    workflow_name: str | None = None
    status: str | None = None
    mode: str | None = None
    finished: bool = False
    retry_of: str | None = None
    started_at: str | None = None
    stopped_at: str | None = None
    duration_ms: int | None = None
    web_url: str | None = None


class ExecutionList(BaseModel):
    configured: bool
    executions: list[Execution]
    #: Opaque cursor for the next page, or None when this is the last one.
    next_cursor: str | None = None


class Workflow(BaseModel):
    id: str
    name: str
    active: bool = False


def _unreachable(exc: httpx.HTTPError) -> HTTPException:
    """Same failure contract as Development › Issues: 502 with the reason, so
    the page can show what went wrong instead of an empty table."""
    if isinstance(exc, httpx.HTTPStatusError):
        detail = f"n8n returned {exc.response.status_code}. Check N8N_API_KEY and its scopes."
        if exc.response.status_code in (401, 403):
            detail = (
                f"n8n rejected the API key ({exc.response.status_code}). It needs the "
                "execution:read/list and workflow:read/list scopes."
            )
        return HTTPException(status.HTTP_502_BAD_GATEWAY, detail)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach n8n: {exc}")


@router.get("/setup", response_model=OpsSetupStatus)
async def get_setup(
    _: UserOut = Depends(require_permission("roles:manage")),
) -> OpsSetupStatus:
    """What still needs configuring before executions show up here."""
    return OpsSetupStatus(**n8n.setup_status())


@router.get("/executions", response_model=ExecutionList)
async def get_executions(
    execution_status: str | None = Query(
        default=None,
        alias="status",
        description=f"Filter by state, one of: {', '.join(n8n.EXECUTION_STATUSES)}",
    ),
    workflow_id: str | None = Query(default=None, description="Only this workflow's runs"),
    cursor: str | None = Query(default=None, description="Page cursor from a previous response"),
    limit: int = Query(default=50, ge=1, le=250),
    _: UserOut = Depends(require_permission("roles:manage")),
) -> ExecutionList:
    """Live execution feed from n8n. 409 when not yet configured (the UI then
    renders the setup checklist); 502 when n8n can't be reached."""
    if not n8n.api_configured():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "n8n API is not configured. See Settings › Operations setup.",
        )
    try:
        page = await n8n.fetch_executions(
            limit=limit,
            status=execution_status,
            workflow_id=workflow_id,
            cursor=cursor,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except httpx.HTTPError as exc:
        raise _unreachable(exc) from exc
    return ExecutionList(
        configured=True,
        executions=[Execution(**e) for e in page["executions"]],
        next_cursor=page["next_cursor"],
    )


@router.get("/workflows", response_model=list[Workflow])
async def get_workflows(
    _: UserOut = Depends(require_permission("roles:manage")),
) -> list[Workflow]:
    """Workflows, for the execution list's filter dropdown."""
    if not n8n.api_configured():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "n8n API is not configured. See Settings › Operations setup.",
        )
    try:
        return [Workflow(**wf) for wf in await n8n.fetch_workflows()]
    except httpx.HTTPError as exc:
        raise _unreachable(exc) from exc
