"""Development tools API — currently the error 'Issues' feed backed by the
self-hosted, Sentry-compatible error tracker (GlitchTip).

Everything is admin-gated (roles:manage) and reads through the Sentry REST API
via observability.fetch_issues. When the API isn't wired up yet, the frontend
shows a setup checklist built from GET /development/setup.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from . import devagent, observability
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


class SourceLine(BaseModel):
    line_no: int | None = None
    text: str = ""


class Frame(BaseModel):
    filename: str | None = None
    function: str | None = None
    module: str | None = None
    line_no: int | None = None
    in_app: bool = False
    context: list[SourceLine] = []


class IssueTag(BaseModel):
    key: str
    value: str


class IssueDetail(Issue):
    """An issue plus its latest event — enough to debug in-app instead of
    bouncing to the tracker's own UI. Frame locals are deliberately not carried."""

    exception_type: str | None = None
    exception_value: str | None = None
    platform: str | None = None
    event_id: str | None = None
    event_created: str | None = None
    frames: list[Frame] = []
    tags: list[IssueTag] = []


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


@router.post("/issues/{issue_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_issue(
    issue_id: str,
    _: UserOut = Depends(require_permission("roles:manage")),
) -> None:
    """Resolve an issue in GlitchTip."""
    try:
        await observability.resolve_issue(issue_id)
    except RuntimeError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            str(e),
        ) from e
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Error tracker returned {exc.response.status_code}.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Could not reach the error tracker: {exc}",
        ) from exc


@router.get("/issues/{issue_id}", response_model=IssueDetail)
async def get_issue(
    issue_id: str,
    _: UserOut = Depends(require_permission("roles:manage")),
) -> IssueDetail:
    """One issue with its latest stack trace. Same failure contract as the list."""
    if not observability.api_configured():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Error-tracker API is not configured. See Development › Issues setup.",
        )
    try:
        issue = await observability.fetch_issue(issue_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found") from exc
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Error tracker returned {exc.response.status_code}. Check the API token and slugs.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Could not reach the error tracker: {exc}",
        ) from exc
    return IssueDetail(**issue)


@router.post("/issues/{issue_id}/job", response_model=devagent.Job, status_code=status.HTTP_201_CREATED)
async def create_job_from_issue(
    issue_id: str,
    user: UserOut = Depends(require_permission("development:run")),
) -> devagent.Job:
    """Create a job to fix an issue. The issue is resolved when the job succeeds."""
    try:
        issue_data = await observability.fetch_issue(issue_id)
    except RuntimeError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            str(e),
        ) from e
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Error tracker returned {exc.response.status_code}.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Could not reach the error tracker: {exc}",
        ) from exc

    # Create a prompt from the issue data
    title = issue_data.get("title", "Untitled issue")
    culprit = issue_data.get("culprit", "")
    level = issue_data.get("level", "error")
    prompt = f"Fix this error: {title}"
    if culprit:
        prompt += f" in {culprit}"

    # Create the job with the issue_id linked
    from fastapi import Form

    # We can't use Form() directly here since we're calling the job creation logic directly
    # Instead, import the internal function that handles job creation
    config = await devagent._config_row()
    if not config["repo_full_name"] or not config["has_token"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No repository configured. Set it in Settings › App › Development.",
        )
    agent = await devagent.resolve_agent()
    if not agent.configured:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No coding agent selected. Bind the 'Development agent' function to a "
            "Claude (Anthropic) or OpenAI connection in Settings › App › AI functions.",
        )

    title_generated = await devagent.generate_title(prompt)
    from . import db

    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO dev_jobs (title, prompt, agent, model, status, created_by, issue_id)
                VALUES ($1, $2, $3, $4, 'pending', $5, $6)
                RETURNING *
                """,
                title_generated,
                prompt,
                agent.agent,
                agent.model,
                user.id,
                issue_id,
            )
            queued = f"Queued for {agent.label}. Created from issue {issue_id}."
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'queued', $2)",
                row["id"],
                queued,
            )
    full = await db.get_pool().fetchrow(f"{devagent._JOB_SELECT} WHERE j.id = $1", row["id"])
    return await devagent._job_out(full)
