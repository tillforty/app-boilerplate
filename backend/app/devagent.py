"""Development agent — automated coding jobs, PRs, and deploys.

The client writes a prompt — optionally with screenshots or files attached; a
coding CLI (Claude Code or OpenAI Codex, picked by whichever provider is bound
to the `development_agent` function in Settings › App › AI functions) builds the
feature on a branch, opens a PR, and one click merges it and rebuilds this
server.

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
Canonical DDL: migrations/0012_dev_agent.sql, migrations/0014_dev_job_files.sql.
"""
import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
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

# Prompt attachments (screenshots, logs, a spec). Stored as bytes in
# dev_job_files because the runner container reaches Postgres and nothing else;
# keep the ceilings in step with `client_max_body_size` in web/nginx.conf.
MAX_ATTACHMENTS = int(os.environ.get("AGENT_MAX_ATTACHMENTS", "10"))
MAX_ATTACHMENT_BYTES = int(os.environ.get("AGENT_ATTACHMENT_MAX_BYTES", str(10 * 1024 * 1024)))
MAX_ATTACHMENT_TOTAL_BYTES = int(
    os.environ.get("AGENT_ATTACHMENT_TOTAL_BYTES", str(25 * 1024 * 1024))
)

_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_name(name: str | None, index: int) -> str:
    """Browser-supplied filename → something safe to write to disk.

    The runner turns this into a real path, so keep directories and anything
    that isn't a plain filename character out of it; leading dots go too, so an
    upload can't pose as `..` or a dotfile. The extension is preserved
    separately, because that is how a CLI recognises a screenshot as an image.
    """
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    stem, _, suffix = base.rpartition(".")
    if not stem:  # no dot at all — the whole name is the stem
        stem, suffix = base, ""
    stem = _UNSAFE_NAME_CHARS.sub("_", stem).strip("._") or f"attachment-{index}"
    suffix = _UNSAFE_NAME_CHARS.sub("", suffix)[:16]
    return f"{stem[:100]}.{suffix}" if suffix else stem[:100]


async def ensure_schema() -> None:
    """Idempotent mirror of migrations/0012_dev_agent.sql + 0014_dev_job_files.sql."""
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
                             CHECK (status IN ('pending', 'running', 'answer_pending', 'merged',
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

            CREATE TABLE IF NOT EXISTS dev_job_files (
                id         bigserial PRIMARY KEY,
                job_id     bigint NOT NULL REFERENCES dev_jobs(id) ON DELETE CASCADE,
                name       text NOT NULL,
                mime       text,
                size       integer NOT NULL,
                data       bytea NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS dev_job_files_job_idx ON dev_job_files (job_id, id);

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

            ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS release_id bigint
                REFERENCES dev_deployments(id) ON DELETE SET NULL;
            ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS merged_at timestamptz;
            ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS merge_requested boolean NOT NULL DEFAULT false;
            CREATE INDEX IF NOT EXISTS dev_jobs_release_idx ON dev_jobs (release_id);
            ALTER TABLE dev_deployments ADD COLUMN IF NOT EXISTS release_number integer;
            ALTER TABLE dev_deployments ADD COLUMN IF NOT EXISTS job_count integer NOT NULL DEFAULT 0;
            """
        )
        # Widen the status CHECK for installs created before releases existed.
        await conn.execute("ALTER TABLE dev_jobs DROP CONSTRAINT IF EXISTS dev_jobs_status_check")
        await conn.execute(
            """
            ALTER TABLE dev_jobs ADD CONSTRAINT dev_jobs_status_check CHECK (
                status IN ('pending', 'running', 'answer_pending', 'merged',
                           'deployment_ready', 'deploying', 'deployed', 'failed', 'cancelled')
            )
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


class JobFile(BaseModel):
    """An attachment's metadata; the bytes are fetched from /jobs/{id}/files/{id}."""

    id: int
    name: str
    mime: str | None
    size: int


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
    files: list[JobFile] = []
    merged_at: datetime | None = None
    release_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobDetail(Job):
    log: str | None
    events: list[JobEvent]


class JobUpdate(BaseModel):
    prompt: str = Field(min_length=5)


def _to_job(row, files: list[JobFile]) -> Job:
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
        files=files,
        merged_at=row["merged_at"],
        release_id=row["release_id"],
        created_by_name=row["created_by_name"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


async def _files_by_job(job_ids: list[int]) -> dict[int, list[JobFile]]:
    """Attachment metadata for several jobs at once — never the bytes."""
    if not job_ids:
        return {}
    rows = await db.get_pool().fetch(
        "SELECT id, job_id, name, mime, size FROM dev_job_files "
        "WHERE job_id = ANY($1::bigint[]) ORDER BY id",
        job_ids,
    )
    grouped: dict[int, list[JobFile]] = {}
    for r in rows:
        grouped.setdefault(r["job_id"], []).append(
            JobFile(id=r["id"], name=r["name"], mime=r["mime"], size=r["size"])
        )
    return grouped


async def _job_out(row) -> Job:
    """Single job row + its attachments, the shape every endpoint returns."""
    return _to_job(row, (await _files_by_job([row["id"]])).get(row["id"], []))


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


# Who started the job. The email is the fallback so the row still names someone
# when a profile has no name filled in; NULL only means the user was deleted.
_USER_LABEL = "COALESCE(NULLIF(TRIM(COALESCE({u}.name, '') || ' ' || COALESCE({u}.surname, '')), ''), {u}.email)"

_JOB_SELECT = f"""
    SELECT j.*, {_USER_LABEL.format(u='u')} AS created_by_name
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
    files = await _files_by_job([r["id"] for r in rows])
    return [_to_job(r, files.get(r["id"], [])) for r in rows]


async def _read_attachments(uploads: list[UploadFile]) -> list[tuple[str, str | None, bytes]]:
    """Validate the uploaded parts and return (name, mime, bytes) triples."""
    if len(uploads) > MAX_ATTACHMENTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"At most {MAX_ATTACHMENTS} files can be attached to one job.",
        )
    attachments: list[tuple[str, str | None, bytes]] = []
    total = 0
    for index, upload in enumerate(uploads, start=1):
        data = await upload.read()
        if not data:
            # A zero-byte file gives the agent nothing to read — drop it quietly
            # rather than failing the whole job over it.
            continue
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"'{upload.filename}' is larger than the "
                f"{MAX_ATTACHMENT_BYTES // (1024 * 1024)} MiB per-file limit.",
            )
        total += len(data)
        if total > MAX_ATTACHMENT_TOTAL_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"The attachments add up to more than "
                f"{MAX_ATTACHMENT_TOTAL_BYTES // (1024 * 1024)} MiB.",
            )
        attachments.append((_safe_name(upload.filename, index), upload.content_type or None, data))
    return attachments


@router.post("/jobs", response_model=Job, status_code=status.HTTP_201_CREATED)
async def create_job(
    prompt: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    user: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Queue a job, optionally with screenshots/files the agent should look at.

    multipart/form-data rather than JSON so the prompt and its attachments land
    in one request: the runner can claim the job within seconds of the insert,
    so there is no window in which to upload them afterwards.
    """
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

    prompt = prompt.strip()
    if len(prompt) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Describe what you want built.")
    attachments = await _read_attachments(files)
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
            if attachments:
                await conn.executemany(
                    "INSERT INTO dev_job_files (job_id, name, mime, size, data) "
                    "VALUES ($1, $2, $3, $4, $5)",
                    [(row["id"], name, mime, len(data), data) for name, mime, data in attachments],
                )
            queued = f"Queued for {agent.label}."
            if attachments:
                queued += " Attached: " + ", ".join(name for name, _, _ in attachments)
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'queued', $2)",
                row["id"],
                queued,
            )
    full = await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", row["id"])
    return await _job_out(full)


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
    base = await _job_out(row)
    return JobDetail(
        **base.model_dump(),
        log=row["log"],
        events=[JobEvent(**dict(e)) for e in events],
    )


@router.get("/jobs/{job_id}/files/{file_id}")
async def download_job_file(
    job_id: int,
    file_id: int,
    _: UserOut = Depends(require_permission("development:read")),
) -> Response:
    """The attachment's bytes, so the UI can preview or download what was sent.

    Always a download, never rendered in place: the MIME type came from whoever
    uploaded the file, so serving it inline on our own origin would make an
    HTML "screenshot" a stored-XSS vector. The UI previews images from the
    fetched blob instead, which this doesn't get in the way of.
    """
    row = await db.get_pool().fetchrow(
        "SELECT name, mime, data FROM dev_job_files WHERE id = $1 AND job_id = $2",
        file_id,
        job_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    return Response(
        content=bytes(row["data"]),
        media_type=row["mime"] or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{row["name"]}"',
            "X-Content-Type-Options": "nosniff",
        },
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
        return await _job_out(await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id))

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
    return await _job_out(await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id))


@router.post("/jobs/{job_id}/answer", response_model=Job)
async def answer_job(
    job_id: int,
    answer: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    user: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Reply to the agent's question and put the job back in the queue.

    The answer is recorded as a timeline event; the runner replays the whole
    question/answer history into the next agent run, so context is preserved.
    Attachments are allowed here too — the question is often about a screen —
    and join the job's existing ones, which the runner re-materialises on every
    run.
    """
    answer = answer.strip()
    if not answer:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An answer is required.")
    attachments = await _read_attachments(files)

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
            if attachments:
                # Cap the whole job, not just this request, so a long
                # question/answer thread can't grow the row set without bound.
                stored = await conn.fetchval(
                    "SELECT COALESCE(SUM(size), 0) FROM dev_job_files WHERE job_id = $1", job_id
                )
                if stored + sum(len(data) for _, _, data in attachments) > MAX_ATTACHMENT_TOTAL_BYTES:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"This job's attachments would exceed "
                        f"{MAX_ATTACHMENT_TOTAL_BYTES // (1024 * 1024)} MiB in total.",
                    )
                await conn.executemany(
                    "INSERT INTO dev_job_files (job_id, name, mime, size, data) "
                    "VALUES ($1, $2, $3, $4, $5)",
                    [(job_id, name, mime, len(data), data) for name, mime, data in attachments],
                )
                answer += " (Attached: " + ", ".join(name for name, _, _ in attachments) + ")"
            await conn.execute(
                "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'answer', $2)",
                job_id,
                answer,
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
    return await _job_out(full)


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
    return await _job_out(full)


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
    return await _job_out(full)


# ── Deployments ──────────────────────────────────────────────────────────────
class ReleaseJob(BaseModel):
    """One function included in a release, for the history table's PR labels."""

    id: int
    title: str
    pr_number: int | None
    pr_url: str | None


class Release(BaseModel):
    id: int
    release_number: int | None
    version_label: str | None
    status: str
    job_count: int
    jobs: list[ReleaseJob] = []
    error: str | None
    deployed_by_name: str | None = None
    created_at: datetime
    finished_at: datetime | None


_RELEASE_SELECT = f"""
    SELECT d.*,
           {_USER_LABEL.format(u='u')} AS deployed_by_name
    FROM dev_deployments d
    LEFT JOIN users u ON u.id = d.deployed_by
"""


def _to_release(row, jobs: list[ReleaseJob] | None = None) -> Release:
    return Release(
        id=row["id"],
        release_number=row["release_number"],
        version_label=row["version_label"],
        status=row["status"],
        job_count=row["job_count"],
        jobs=jobs or [],
        error=row["error"],
        deployed_by_name=row["deployed_by_name"],
        created_at=row["created_at"],
        finished_at=row["finished_at"],
    )


@router.get("/releases", response_model=list[Release])
async def list_releases(
    limit: int = Query(default=50, ge=1, le=200),
    _: UserOut = Depends(require_permission("development:read")),
) -> list[Release]:
    """History of every release that was shipped, newest first, each listing the
    functions it carried so the PR numbers stay traceable."""
    rows = await db.get_pool().fetch(
        f"{_RELEASE_SELECT} ORDER BY d.created_at DESC LIMIT $1", limit
    )
    if not rows:
        return []
    job_rows = await db.get_pool().fetch(
        """
        SELECT id, title, pr_number, pr_url, release_id FROM dev_jobs
        WHERE release_id = ANY($1::bigint[]) ORDER BY id
        """,
        [r["id"] for r in rows],
    )
    by_release: dict[int, list[ReleaseJob]] = {}
    for j in job_rows:
        by_release.setdefault(j["release_id"], []).append(
            ReleaseJob(id=j["id"], title=j["title"], pr_number=j["pr_number"], pr_url=j["pr_url"])
        )
    return [_to_release(r, by_release.get(r["id"], [])) for r in rows]


@router.post("/jobs/{job_id}/merge", response_model=Job)
async def request_merge(
    job_id: int,
    _: UserOut = Depends(require_permission("development:run")),
) -> Job:
    """Retry an auto-merge that failed. Merging normally happens by itself the
    moment the agent finishes, so this is only for the exception."""
    row = await db.get_pool().fetchrow(
        "SELECT status, pr_number FROM dev_jobs WHERE id = $1", job_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if row["status"] != "deployment_ready" or row["pr_number"] is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This job has no open pull request awaiting a merge."
        )
    await db.get_pool().execute(
        "UPDATE dev_jobs SET merge_requested = true, error = NULL, updated_at = now() WHERE id = $1",
        job_id,
    )
    return await _job_out(await db.get_pool().fetchrow(f"{_JOB_SELECT} WHERE j.id = $1", job_id))


@router.post("/releases", response_model=Release, status_code=status.HTTP_202_ACCEPTED)
async def create_release(
    user: UserOut = Depends(require_permission("development:deploy")),
) -> Release:
    """Ship everything that is merged but not yet deployed, in one rebuild.

    The release is whatever is on the base branch right now: each merged job is
    stamped with this release id up front, so a job merged *after* the button is
    pressed waits for the next one rather than being silently claimed by this.
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
            pending = await conn.fetch(
                "SELECT id FROM dev_jobs WHERE status = 'merged' FOR UPDATE"
            )
            if not pending:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "Nothing is merged and waiting to be deployed."
                )
            next_number = await conn.fetchval(
                "SELECT COALESCE(MAX(release_number), 0) + 1 FROM dev_deployments"
            )
            rel = await conn.fetchrow(
                """
                INSERT INTO dev_deployments
                    (release_number, version_label, status, job_count, deployed_by)
                VALUES ($1, $2, 'pending', $3, $4)
                RETURNING *
                """,
                next_number,
                f"Release #{next_number}",
                len(pending),
                user.id,
            )
            await conn.execute(
                """
                UPDATE dev_jobs SET status = 'deploying', release_id = $1, updated_at = now()
                WHERE status = 'merged'
                """,
                rel["id"],
            )
            for j in pending:
                await conn.execute(
                    "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, 'deploy', $2)",
                    j["id"],
                    f"Included in release #{next_number}, requested by {user.name or user.email}.",
                )
    full = await db.get_pool().fetchrow(f"{_RELEASE_SELECT} WHERE d.id = $1", rel["id"])
    jobs = await db.get_pool().fetch(
        "SELECT id, title, pr_number, pr_url FROM dev_jobs WHERE release_id = $1 ORDER BY id",
        rel["id"],
    )
    return _to_release(full, [ReleaseJob(**dict(j)) for j in jobs])
