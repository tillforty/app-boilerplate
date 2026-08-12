"""Development agent — automated coding jobs, PRs, and deploys.

The client writes a prompt; a coding CLI (Claude Code or OpenAI Codex, picked by
whichever provider is bound to the `development_agent` function in
Settings › App › AI functions) builds the feature on a branch, opens a PR, and
one click merges it and rebuilds this server.

Division of labour — this module is the **API only**. It never clones, runs a
CLI, or shells out: the API container has no git, no Node, no docker socket.
All of that happens in the `agent_runner` container (see agent-runner/runner.py),
which claims rows from `dev_jobs` / `dev_deployments` and writes results back.
So every endpoint here is a fast DB write plus, for /validate, a few GitHub
REST calls.

Job lifecycle:
    pending → running → [answer_pending ⇄ running] → deployment_ready
            → deploying → deployed        (or failed / cancelled)

Secrets: the GitHub token is written to the pgcrypto vault under
`dev_agent:github_token` and never returned to the browser (only `has_token`).
Canonical DDL: migrations/0012_dev_agent.sql.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from . import db, vault
from .auth import UserOut
from .roles import require_permission

router = APIRouter(prefix="/development", tags=["development"])

GITHUB_API = "https://api.github.com"

# Where the Deploy button pulls and rebuilds. Env-only on purpose: docker-compose
# bind-mounts this exact path into the runner, so a value edited in the UI could
# name a directory the container cannot even see. Change it in .env, then redeploy.
CHECKOUT_PATH = os.environ.get("APP_CHECKOUT_PATH", "/opt/app-boilerplate")
TOKEN_SECRET_NAME = "dev_agent:github_token"

# The runner heartbeats on every poll; allow a few missed beats before we call
# it offline so a brief restart doesn't flip the UI to "runner down".
RUNNER_STALE_AFTER = timedelta(seconds=90)

# Provider (from the bound LLM credential) → which CLI the runner invokes.
PROVIDER_AGENTS: dict[str, dict] = {
    "anthropic": {"agent": "claude_code", "label": "Claude Code"},
    "openai": {"agent": "codex", "label": "OpenAI Codex"},
}

# The llmconfig function key this feature is driven by.
AGENT_FUNCTION_KEY = "development_agent"

# Statuses a job can be deployed from / re-run from.
DEPLOYABLE = {"deployment_ready", "failed"}
RETRYABLE = {"failed", "cancelled"}


async def ensure_schema() -> None:
    """Idempotent mirror of migrations/0012_dev_agent.sql."""
    async with db.get_pool().acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dev_settings (
                id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                repo_full_name text,
                base_branch    text NOT NULL DEFAULT 'main',
                checkout_path  text NOT NULL DEFAULT '/opt/app-boilerplate',
                deploy_enabled boolean NOT NULL DEFAULT false,
                has_token      boolean NOT NULL DEFAULT false,
                validation     jsonb,
                validated_at   timestamptz,
                runner_seen_at timestamptz,
                runner_info    jsonb,
                created_at     timestamptz NOT NULL DEFAULT now(),
                updated_at     timestamptz NOT NULL DEFAULT now()
            );
            INSERT INTO dev_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

            CREATE TABLE IF NOT EXISTS dev_jobs (
                id           bigserial PRIMARY KEY,
                title        text NOT NULL,
                prompt       text NOT NULL,
                agent        text NOT NULL CHECK (agent IN ('claude_code', 'codex')),
                model        text,
                status       text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'running', 'answer_pending',
                                               'deployment_ready', 'deploying', 'deployed',
                                               'failed', 'cancelled')),
                branch       text,
                pr_number    integer,
                pr_url       text,
                commit_sha   text,
                question     text,
                error        text,
                log          text,
                attempts     integer NOT NULL DEFAULT 0,
                created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
                created_at   timestamptz NOT NULL DEFAULT now(),
                started_at   timestamptz,
                finished_at  timestamptz,
                updated_at   timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS dev_jobs_status_idx  ON dev_jobs (status);
            CREATE INDEX IF NOT EXISTS dev_jobs_created_idx ON dev_jobs (created_at DESC);

            CREATE TABLE IF NOT EXISTS dev_job_events (
                id         bigserial PRIMARY KEY,
                job_id     bigint NOT NULL REFERENCES dev_jobs(id) ON DELETE CASCADE,
                kind       text NOT NULL,
                message    text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS dev_job_events_job_idx ON dev_job_events (job_id, created_at);

            CREATE TABLE IF NOT EXISTS dev_deployments (
                id            bigserial PRIMARY KEY,
                job_id        bigint REFERENCES dev_jobs(id) ON DELETE SET NULL,
                pr_number     integer,
                pr_url        text,
                merge_sha     text,
                version_label text,
                status        text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'merging', 'deploying', 'deployed', 'failed')),
                container_id  text,
                error         text,
                log           text,
                deployed_by   bigint REFERENCES users(id) ON DELETE SET NULL,
                created_at    timestamptz NOT NULL DEFAULT now(),
                finished_at   timestamptz
            );
            CREATE INDEX IF NOT EXISTS dev_deployments_created_idx ON dev_deployments (created_at DESC);
            """
        )


# ── Agent resolution (Settings › App › AI functions) ─────────────────────────
class AgentInfo(BaseModel):
    """Which coding CLI the next job will use, per the function binding."""

    configured: bool
    agent: str | None = None
    label: str | None = None
    provider: str | None = None
    model: str | None = None
    reason: str | None = None


async def resolve_agent() -> AgentInfo:
    """Read the `development_agent` binding and map its provider to a CLI.

    Unbound, keyless, or bound to a provider with no coding CLI all resolve to
    `configured=False` with a reason the UI shows next to the prompt box.
    """
    row = await db.get_pool().fetchrow(
        """
        SELECT c.provider, c.has_key, c.label AS credential_label,
               COALESCE(b.model, c.default_model) AS model
        FROM ai_function_bindings b
        JOIN llm_credentials c ON c.id = b.credential_id
        WHERE b.function_key = $1
        """,
        AGENT_FUNCTION_KEY,
    )
    if row is None:
        return AgentInfo(configured=False, reason="unbound")
    if not row["has_key"]:
        return AgentInfo(configured=False, provider=row["provider"], reason="no_key")
    mapping = PROVIDER_AGENTS.get(row["provider"])
    if mapping is None:
        return AgentInfo(configured=False, provider=row["provider"], reason="unsupported_provider")
    return AgentInfo(
        configured=True,
        agent=mapping["agent"],
        label=mapping["label"],
        provider=row["provider"],
        model=row["model"],
    )


# ── Config ───────────────────────────────────────────────────────────────────
class ValidationCheck(BaseModel):
    key: str
    ok: bool
    detail: str


class ValidationResult(BaseModel):
    ok: bool
    checks: list[ValidationCheck]


class DevConfig(BaseModel):
    repo_full_name: str | None
    base_branch: str
    checkout_path: str
    deploy_enabled: bool
    has_token: bool
    validation: ValidationResult | None
    validated_at: datetime | None
    runner_online: bool
    runner_seen_at: datetime | None
    runner_info: dict | None
    agent: AgentInfo


class DevConfigUpdate(BaseModel):
    repo_full_name: str | None = Field(default=None, max_length=200)
    base_branch: str | None = Field(default=None, min_length=1, max_length=200)
    deploy_enabled: bool | None = None
    # Write-only: non-empty stores/rotates the vault token, blank/None keeps it.
    github_token: str | None = None
    # Explicit opt-out, since a blank github_token means "unchanged".
    clear_token: bool = False


def _runner_online(seen_at: datetime | None) -> bool:
    if seen_at is None:
        return False
    return datetime.now(timezone.utc) - seen_at < RUNNER_STALE_AFTER


def _loads(value) -> dict | None:
    """dev_settings.validation/runner_info come back as JSON text from asyncpg."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


async def _config_row():
    row = await db.get_pool().fetchrow("SELECT * FROM dev_settings WHERE id = 1")
    if row is None:
        await db.get_pool().execute("INSERT INTO dev_settings (id) VALUES (1) ON CONFLICT DO NOTHING")
        row = await db.get_pool().fetchrow("SELECT * FROM dev_settings WHERE id = 1")
    return row


async def _to_config(row) -> DevConfig:
    validation = _loads(row["validation"])
    return DevConfig(
        repo_full_name=row["repo_full_name"],
        base_branch=row["base_branch"],
        checkout_path=CHECKOUT_PATH,
        deploy_enabled=row["deploy_enabled"],
        has_token=row["has_token"],
        validation=ValidationResult(**validation) if validation else None,
        validated_at=row["validated_at"],
        runner_online=_runner_online(row["runner_seen_at"]),
        runner_seen_at=row["runner_seen_at"],
        runner_info=_loads(row["runner_info"]),
        agent=await resolve_agent(),
    )


@router.get("/config", response_model=DevConfig)
async def get_config(
    _: UserOut = Depends(require_permission("development:manage")),
) -> DevConfig:
    """Repo/deploy configuration plus live runner + agent-binding status."""
    return await _to_config(await _config_row())


@router.put("/config", response_model=DevConfig)
async def update_config(
    body: DevConfigUpdate,
    _: UserOut = Depends(require_permission("development:manage")),
) -> DevConfig:
    existing = await _config_row()

    repo = existing["repo_full_name"] if body.repo_full_name is None else (body.repo_full_name.strip() or None)
    if repo is not None and repo.count("/") != 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Repository must be in 'owner/name' form, e.g. tillforty/app-boilerplate.",
        )
    base_branch = existing["base_branch"] if body.base_branch is None else body.base_branch.strip()
    deploy_enabled = existing["deploy_enabled"] if body.deploy_enabled is None else body.deploy_enabled

    new_token = (body.github_token or "").strip()
    has_token = False if body.clear_token else (existing["has_token"] or bool(new_token))
    # Any change to repo/token invalidates the previous validation result.
    revalidate = (
        repo != existing["repo_full_name"]
        or base_branch != existing["base_branch"]
        or bool(new_token)
        or body.clear_token
    )

    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE dev_settings
                SET repo_full_name = $1, base_branch = $2,
                    deploy_enabled = $3, has_token = $4,
                    validation = CASE WHEN $5 THEN NULL ELSE validation END,
                    validated_at = CASE WHEN $5 THEN NULL ELSE validated_at END,
                    updated_at = now()
                WHERE id = 1
                RETURNING *
                """,
                repo,
                base_branch,
                deploy_enabled,
                has_token,
                revalidate,
            )
            if body.clear_token:
                await conn.execute("DELETE FROM vault_secrets WHERE name = $1", TOKEN_SECRET_NAME)
            elif new_token:
                await vault.set_secret(TOKEN_SECRET_NAME, new_token)
    return await _to_config(row)


# ── Access validation ────────────────────────────────────────────────────────
async def _github(client: httpx.AsyncClient, token: str, path: str) -> httpx.Response:
    return await client.get(
        f"{GITHUB_API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )


async def _run_validation(row) -> ValidationResult:
    """Probe every capability the pipeline needs: read, push, PR, merge, deploy.

    Read-only on purpose — it never creates a branch or PR just to test. Push and
    merge are inferred from the repo `permissions` object plus branch protection,
    which is what actually gates the runner later.
    """
    checks: list[ValidationCheck] = []

    def add(key: str, ok: bool, detail: str) -> None:
        checks.append(ValidationCheck(key=key, ok=ok, detail=detail))

    repo = row["repo_full_name"]
    base_branch = row["base_branch"]
    token = await vault.get_secret(TOKEN_SECRET_NAME)

    if not repo:
        add("repo", False, "No repository configured.")
        return ValidationResult(ok=False, checks=checks)
    add("repo", True, repo)

    if not token:
        add("token", False, "No GitHub token stored.")
        return ValidationResult(ok=False, checks=checks)

    async with httpx.AsyncClient(timeout=15) as client:
        # Who the token belongs to — also the cheapest liveness check.
        try:
            me = await _github(client, token, "/user")
        except httpx.HTTPError as exc:
            add("token", False, f"Could not reach GitHub: {exc}")
            return ValidationResult(ok=False, checks=checks)
        if me.status_code == 401:
            add("token", False, "Token rejected by GitHub (401). Is it expired or revoked?")
            return ValidationResult(ok=False, checks=checks)
        if me.status_code != 200:
            add("token", False, f"GitHub returned {me.status_code} for /user.")
            return ValidationResult(ok=False, checks=checks)
        add("token", True, f"Authenticated as {me.json().get('login', '?')}.")

        # Repo access + the permission bits that gate pull / push / merge.
        r = await _github(client, token, f"/repos/{repo}")
        if r.status_code == 404:
            add("pull", False, "Repository not found, or the token can't see it.")
            return ValidationResult(ok=False, checks=checks)
        if r.status_code != 200:
            add("pull", False, f"GitHub returned {r.status_code} for the repository.")
            return ValidationResult(ok=False, checks=checks)

        repo_json = r.json()
        perms = repo_json.get("permissions") or {}
        add("pull", bool(perms.get("pull")), "Read access to the repository." if perms.get("pull") else "Token cannot pull.")
        add(
            "push",
            bool(perms.get("push")),
            "Can push branches." if perms.get("push") else "Token lacks write access — the agent can't push its branch.",
        )

        # Base branch must exist; the PR is opened against it.
        b = await _github(client, token, f"/repos/{repo}/branches/{base_branch}")
        add(
            "base_branch",
            b.status_code == 200,
            f"Base branch '{base_branch}' exists."
            if b.status_code == 200
            else f"Base branch '{base_branch}' not found ({b.status_code}).",
        )

        # Pull-request API reachable (issues/PRs can be disabled on a repo).
        p = await _github(client, token, f"/repos/{repo}/pulls?per_page=1")
        add(
            "pull_request",
            p.status_code == 200 and bool(perms.get("push")),
            "Can open pull requests."
            if p.status_code == 200 and perms.get("push")
            else "Pull requests unavailable with this token.",
        )

        # Merge: write access, minus anything branch protection would block.
        merge_ok = bool(perms.get("push"))
        merge_detail = (
            f"Can merge into {base_branch}."
            if merge_ok
            else f"Token lacks write access, so it can't merge into {base_branch}."
        )
        if b.status_code == 200 and (b.json() or {}).get("protected"):
            if perms.get("admin") and merge_ok:
                merge_detail = f"'{base_branch}' is protected; token has admin rights."
            else:
                merge_ok = False
                merge_detail = (
                    f"'{base_branch}' is protected and the token isn't an admin — "
                    "merges may be blocked by required reviews/checks."
                )
        add("merge", merge_ok, merge_detail)

    # Deploy readiness is the runner's business: it owns the checkout + docker.
    info = _loads(row["runner_info"]) or {}
    online = _runner_online(row["runner_seen_at"])
    add("runner", online, "Agent runner is online." if online else "Agent runner is not running (start the 'agent' compose profile).")

    if not row["deploy_enabled"]:
        add("deploy", False, "Deploy is switched off for this app.")
    elif not online:
        add("deploy", False, "Can't verify the deploy target while the runner is offline.")
    else:
        checkout_ok = bool(info.get("checkout_ok"))
        remote = info.get("checkout_remote") or "unknown"
        docker_ok = bool(info.get("has_docker"))
        if not checkout_ok:
            add("deploy", False, f"Checkout {CHECKOUT_PATH} is not a git repository on the host.")
        elif not docker_ok:
            add("deploy", False, "The runner has no access to the Docker socket, so it can't rebuild.")
        elif repo.lower() not in remote.lower():
            add(
                "deploy",
                False,
                f"Checkout remote ({remote}) doesn't match the configured repo — deploying would ship a different app.",
            )
        else:
            add("deploy", True, f"{CHECKOUT_PATH} tracks {remote} and Docker is reachable.")

    return ValidationResult(ok=all(c.ok for c in checks), checks=checks)


@router.post("/config/validate", response_model=DevConfig)
async def validate_config(
    _: UserOut = Depends(require_permission("development:manage")),
) -> DevConfig:
    """Check that pull / push / PR / merge / deploy are all actually available."""
    row = await _config_row()
    result = await _run_validation(row)
    updated = await db.get_pool().fetchrow(
        """
        UPDATE dev_settings
        SET validation = $1::jsonb, validated_at = now(), updated_at = now()
        WHERE id = 1
        RETURNING *
        """,
        result.model_dump_json(),
    )
    return await _to_config(updated)


# ── Jobs ─────────────────────────────────────────────────────────────────────
class JobEvent(BaseModel):
    id: int
    kind: str
    message: str
    created_at: datetime


class Job(BaseModel):
    id: int
    title: str
    prompt: str
    agent: str
    model: str | None
    status: str
    branch: str | None
    pr_number: int | None
    pr_url: str | None
    commit_sha: str | None
    question: str | None
    error: str | None
    attempts: int
    created_by_name: str | None = None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobDetail(Job):
    log: str | None
    events: list[JobEvent]


class JobCreate(BaseModel):
    prompt: str = Field(min_length=5)


class JobUpdate(BaseModel):
    prompt: str = Field(min_length=5)


class AnswerIn(BaseModel):
    answer: str = Field(min_length=1)


def _to_job(row) -> Job:
    return Job(
        id=row["id"],
        title=row["title"],
        prompt=row["prompt"],
        agent=row["agent"],
        model=row["model"],
        status=row["status"],
        branch=row["branch"],
        pr_number=row["pr_number"],
        pr_url=row["pr_url"],
        commit_sha=row["commit_sha"],
        question=row["question"],
        error=row["error"],
        attempts=row["attempts"],
        created_by_name=row["created_by_name"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


_TITLE_SYSTEM = (
    "You name software tasks. Reply with ONE short imperative title for the task "
    "described by the user — six words or fewer, no quotes, no trailing period, "
    "no prefix. Reply with the title and nothing else."
)


async def generate_title(prompt: str) -> str:
    """Name the job with the operating agent, so the jobs table reads as a list
    of changes rather than a wall of prompt text.

    Best-effort by design: a missing binding, a slow provider, or a junk answer
    all fall back to the prompt's first line. Naming is never worth failing a
    job the user actually asked for.
    """
    fallback = (prompt.strip().splitlines() or [""])[0][:120].strip() or "Untitled job"
    try:
        from . import llm  # lazy: llm imports llmconfig, which imports us indirectly

        text = await asyncio.wait_for(
            llm.complete(
                [
                    {"role": "system", "content": _TITLE_SYSTEM},
                    {"role": "user", "content": prompt[:4000]},
                ],
                max_tokens=32,
            ),
            timeout=20,
        )
    except Exception:  # noqa: BLE001 — any failure just means "use the fallback"
        return fallback
    # Models like to wrap titles in quotes or prepend "Title:".
    title = (text or "").strip().strip('"').strip("'").rstrip(".").strip()
    if title.lower().startswith("title:"):
        title = title[6:].strip()
    # A multi-line answer means it ignored the instruction; keep the first line.
    title = (title.splitlines() or [""])[0].strip()
    return title[:120] or fallback


_JOB_SELECT = """
    SELECT j.*, NULLIF(TRIM(COALESCE(u.name, '') || ' ' || COALESCE(u.surname, '')), '') AS created_by_name
    FROM dev_jobs j
    LEFT JOIN users u ON u.id = j.created_by
"""


@router.get("/jobs", response_model=list[Job])
async def list_jobs(
    limit: int = Query(default=50, ge=1, le=200),
    _: UserOut = Depends(require_permission("development:read")),
) -> list[Job]:
    rows = await db.get_pool().fetch(
        f"{_JOB_SELECT} ORDER BY j.created_at DESC LIMIT $1", limit
    )
    return [_to_job(r) for r in rows]


@router.post("/jobs", response_model=Job, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobCreate,
    user: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Queue a job. The runner picks it up on its next poll (a few seconds)."""
    config = await _config_row()
    if not config["repo_full_name"] or not config["has_token"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No repository configured. Set it in Settings › App › Development.",
        )
    agent = await resolve_agent()
    if not agent.configured:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No coding agent selected. Bind the 'Development agent' function to a "
            "Claude (Anthropic) or OpenAI connection in Settings › App › AI functions.",
        )

    prompt = body.prompt.strip()
    title = await generate_title(prompt)

    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO dev_jobs (title, prompt, agent, model, status, created_by)
                VALUES ($1, $2, $3, $4, 'pending', $5)
                RETURNING *
                """,
                title,
                prompt,
                agent.agent,
                agent.model,
                user.id,
            )
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'queued', $2)",
                row["id"],
                f"Queued for {agent.label}.",
            )
    full = await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", row["id"])
    return _to_job(full)


@router.get("/jobs/{job_id}", response_model=JobDetail)
async def get_job(
    job_id: int,
    _: UserOut = Depends(require_permission("development:read")),
) -> JobDetail:
    row = await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    events = await db.get_pool().fetch(
        "SELECT id, kind, message, created_at FROM dev_job_events WHERE job_id = $1 ORDER BY created_at, id",
        job_id,
    )
    base = _to_job(row)
    return JobDetail(
        **base.model_dump(),
        log=row["log"],
        events=[JobEvent(**dict(e)) for e in events],
    )


@router.patch("/jobs/{job_id}", response_model=Job)
async def update_job(
    job_id: int,
    body: JobUpdate,
    _: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Reword a job that hasn't started yet. Pending only — once the agent has a
    working tree, changing the brief underneath it would be meaningless."""
    prompt = body.prompt.strip()
    current = await db.get_pool().fetchrow("SELECT * FROM dev_jobs WHERE id = $1", job_id)
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if current["status"] != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only a pending job can be edited."
        )
    if prompt == current["prompt"]:
        return _to_job(await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id))

    # Rename to match the new brief. Done before the transaction so a slow model
    # doesn't hold the row lock the runner needs to claim work.
    title = await generate_title(prompt)

    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            # Re-check under the lock: the runner may have claimed it meanwhile.
            row = await conn.fetchrow(
                "SELECT status FROM dev_jobs WHERE id = $1 FOR UPDATE", job_id
            )
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
            if row["status"] != "pending":
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "The agent just started this job, so it can no longer be edited.",
                )
            await conn.execute(
                "UPDATE dev_jobs SET prompt = $2, title = $3, updated_at = now() WHERE id = $1",
                job_id,
                prompt,
                title,
            )
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'edited', 'Prompt edited before the run started.')",
                job_id,
            )
    return _to_job(await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id))


@router.post("/jobs/{job_id}/answer", response_model=Job)
async def answer_job(
    job_id: int,
    body: AnswerIn,
    user: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Reply to the agent's question and put the job back in the queue.

    The answer is recorded as a timeline event; the runner replays the whole
    question/answer history into the next agent run, so context is preserved.
    """
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT * FROM dev_jobs WHERE id = $1 FOR UPDATE", job_id
            )
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
            if row["status"] != "answer_pending":
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "This job isn't waiting for an answer."
                )
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'answer', $2)",
                job_id,
                body.answer.strip(),
            )
            await conn.execute(
                """
                UPDATE dev_jobs
                SET status = 'pending', question = NULL, error = NULL, updated_at = now()
                WHERE id = $1
                """,
                job_id,
            )
    full = await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id)
    return _to_job(full)


@router.post("/jobs/{job_id}/retry", response_model=Job)
async def retry_job(
    job_id: int,
    _: UserOut = Depends(require_permission("development:run")),
) -> Job:
    row = await db.get_pool().fetchrow("SELECT status FROM dev_jobs WHERE id = $1", job_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if row["status"] not in RETRYABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only failed or cancelled jobs can be retried.")
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE dev_jobs
                SET status = 'pending', error = NULL, question = NULL,
                    started_at = NULL, finished_at = NULL, updated_at = now()
                WHERE id = $1
                """,
                job_id,
            )
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'queued', 'Re-queued.')",
                job_id,
            )
    full = await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id)
    return _to_job(full)


@router.post("/jobs/{job_id}/cancel", response_model=Job)
async def cancel_job(
    job_id: int,
    _: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Cancel a job that hasn't merged yet. A run already in flight finishes in
    the runner, which then sees the cancelled status and drops its result."""
    row = await db.get_pool().fetchrow("SELECT status FROM dev_jobs WHERE id = $1", job_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if row["status"] in {"deployed", "deploying"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "A deployed job can't be cancelled.")
    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE dev_jobs SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE id = $1",
                job_id,
            )
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'cancelled', 'Cancelled by an operator.')",
                job_id,
            )
    full = await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id)
    return _to_job(full)


# ── Deployments ──────────────────────────────────────────────────────────────
class Deployment(BaseModel):
    id: int
    job_id: int | None
    job_title: str | None = None
    pr_number: int | None
    pr_url: str | None
    merge_sha: str | None
    version_label: str | None
    status: str
    error: str | None
    deployed_by_name: str | None = None
    created_at: datetime
    finished_at: datetime | None


_DEPLOYMENT_SELECT = """
    SELECT d.*, j.title AS job_title,
           NULLIF(TRIM(COALESCE(u.name, '') || ' ' || COALESCE(u.surname, '')), '') AS deployed_by_name
    FROM dev_deployments d
    LEFT JOIN dev_jobs j ON j.id = d.job_id
    LEFT JOIN users u ON u.id = d.deployed_by
"""


def _to_deployment(row) -> Deployment:
    return Deployment(
        id=row["id"],
        job_id=row["job_id"],
        job_title=row["job_title"],
        pr_number=row["pr_number"],
        pr_url=row["pr_url"],
        merge_sha=row["merge_sha"],
        version_label=row["version_label"],
        status=row["status"],
        error=row["error"],
        deployed_by_name=row["deployed_by_name"],
        created_at=row["created_at"],
        finished_at=row["finished_at"],
    )


@router.get("/deployments", response_model=list[Deployment])
async def list_deployments(
    limit: int = Query(default=50, ge=1, le=200),
    _: UserOut = Depends(require_permission("development:read")),
) -> list[Deployment]:
    """History of every version that was shipped, newest first."""
    rows = await db.get_pool().fetch(
        f"{_DEPLOYMENT_SELECT} ORDER BY d.created_at DESC LIMIT $1", limit
    )
    return [_to_deployment(r) for r in rows]


@router.post("/jobs/{job_id}/deploy", response_model=Deployment, status_code=status.HTTP_202_ACCEPTED)
async def deploy_job(
    job_id: int,
    user: UserOut = Depends(require_permission("development:deploy")),
) -> Deployment:
    """Merge the job's PR and rebuild this server.

    Returns immediately with a `pending` deployment; the runner does the merge
    and the rebuild, then flips the row (and the job) to `deployed` or `failed`.
    """
    config = await _config_row()
    if not config["deploy_enabled"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Deploy is switched off. Enable it in Settings › App › Development.",
        )
    if not _runner_online(config["runner_seen_at"]):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The agent runner is offline, so nothing can be deployed right now.",
        )

    async with db.get_pool().acquire() as conn:
        async with conn.transaction():
            job = await conn.fetchrow("SELECT * FROM dev_jobs WHERE id = $1 FOR UPDATE", job_id)
            if job is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
            if job["status"] != "deployment_ready":
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "This job has no pull request ready to deploy."
                )
            if job["pr_number"] is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "This job has no pull request.")

            dep = await conn.fetchrow(
                """
                INSERT INTO dev_deployments
                    (job_id, pr_number, pr_url, version_label, status, deployed_by)
                VALUES ($1, $2, $3, $4, 'pending', $5)
                RETURNING *
                """,
                job_id,
                job["pr_number"],
                job["pr_url"],
                f"PR #{job['pr_number']}",
                user.id,
            )
            await conn.execute(
                "UPDATE dev_jobs SET status = 'deploying', updated_at = now() WHERE id = $1",
                job_id,
            )
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'deploy', $2)",
                job_id,
                f"Deploy requested by {user.name or user.email}.",
            )
    full = await db.get_pool().fetchrow(f"{_DEPLOYMENT_SELECT} WHERE d.id = $1", dep["id"])
    return _to_deployment(full)
