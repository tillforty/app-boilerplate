"""Development tools API — currently the error 'Issues' feed backed by the
self-hosted, Sentry-compatible error tracker (GlitchTip).

Everything is admin-gated (roles:manage) and reads through the Sentry REST API
via observability.fetch_issues. When the API isn't wired up yet, the frontend
shows a setup checklist built from GET /development/setup.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from . import observability
from .auth import UserOut
from .roles import require_permission

router = APIRouter(prefix="/development", tags=["development"])


class DevSetupStatus(BaseModel):
    """Per-requirement flags driving the Development › Issues setup checklist."""

    glitchtip_enabled: bool
    capture_configured: bool
    api_token_configured: bool
    org_slug_configured: bool
    project_slug_configured: bool
    api_configured: bool
    environment: str
    ui_url: str | None


class Issue(BaseModel):
    id: str
    short_id: str | None = None
    title: str
    culprit: str | None = None
    level: str | None = None
    status: str | None = None
    count: int = 0
    user_count: int = 0
    first_seen: str | None = None
    last_seen: str | None = None
    web_url: str | None = None


class IssueList(BaseModel):
    configured: bool
    issues: list[Issue]


@router.get("/setup", response_model=DevSetupStatus)
async def get_setup(
    _: UserOut = Depends(require_permission("roles:manage")),
) -> DevSetupStatus:
    """What still needs configuring before errors show up live."""
    return DevSetupStatus(**observability.setup_status())


@router.get("/issues", response_model=IssueList)
async def get_issues(
    query: str | None = Query(default=None, description="Sentry issue query, e.g. 'is:unresolved'"),
    limit: int = Query(default=50, ge=1, le=100),
    _: UserOut = Depends(require_permission("roles:manage")),
) -> IssueList:
    """Live issue feed from GlitchTip. 409 when not yet configured (the UI then
    renders the setup checklist); 502 when the tracker can't be reached."""
    if not observability.api_configured():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Error-tracker API is not configured. See Development › Issues setup.",
        )
    try:
        issues = await observability.fetch_issues(query=query, limit=limit)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Error tracker returned {exc.response.status_code}. Check the API token and slugs.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Could not reach the error tracker: {exc}",
        ) from exc
    return IssueList(configured=True, issues=[Issue(**i) for i in issues])
