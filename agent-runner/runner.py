"""Development agent runner — the worker behind Development › Agent.

Polls Postgres for queued jobs and deployments and does the parts the API
cannot: clone the repo, run a coding CLI in auto mode, push a branch, open a
pull request, merge it, and rebuild this server.

    pending → running → [answer_pending ⇄ running] → deployment_ready
            → deploying → deployed        (or failed / cancelled)

Two design points worth knowing before editing:

1. **The agent runs as an unprivileged user.** The worker itself is root (it
   needs the Docker socket), but every coding-CLI invocation drops to `agent`
   via subprocess(user=...). Generated code never runs as root.

2. **Deploys run in a sibling container, not here.** `./start.sh` does
   `docker compose up -d --build`, which recreates *this* container — a deploy
   run in-process would kill itself halfway. So the rebuild is launched as a
   detached sibling (not part of the compose project) and its container id is
   stored on the deployment row. After the runner is restarted by that very
   rebuild, `reconcile_deployments` picks the result back up.

Secrets come from the same pgcrypto vault the API writes to; this process reads
them with pgp_sym_decrypt using the shared VAULT_KEY.
"""
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import traceback
from datetime import datetime, timezone

import asyncpg
import httpx

DATABASE_URL = os.environ["DATABASE_URL"]
VAULT_KEY = os.environ["VAULT_KEY"]

GITHUB_API = "https://api.github.com"
TOKEN_SECRET_NAME = "dev_agent:github_token"

POLL_INTERVAL = float(os.environ.get("AGENT_POLL_INTERVAL", "5"))
# Wall-clock ceiling for a single agent run, so a stuck CLI can't wedge the queue.
AGENT_TIMEOUT = int(os.environ.get("AGENT_TIMEOUT", "1800"))
DEPLOY_TIMEOUT = int(os.environ.get("AGENT_DEPLOY_TIMEOUT", "1800"))
WORKSPACE = os.environ.get("AGENT_WORKSPACE", "/work")
# Env-only, and bind-mounted at this same path by docker-compose.yml.
CHECKOUT_PATH = os.environ.get("APP_CHECKOUT_PATH", "/opt/app-boilerplate")
AGENT_USER = os.environ.get("AGENT_USER", "agent")

# Authorship stamped on the commits the agent writes. Set these per install so a
# client's history is attributed to that client, not to whoever built the stack.
AGENT_GIT_NAME = os.environ.get("AGENT_GIT_NAME", "Development agent")
AGENT_GIT_EMAIL = os.environ.get("AGENT_GIT_EMAIL", "agent@localhost")

# The coding CLI is the one thing this process starts that runs LLM-written code,
# so it gets an allow-list instead of this container's environment. That env is
# `env_file: .env` in full — VAULT_KEY, POSTGRES_PASSWORD, JWT_SECRET, the OAuth
# client secrets, SMTP and LLM credentials — none of which a job needs. Anything
# it legitimately requires is passed explicitly at the call site.
AGENT_ENV_KEEP = frozenset({
    "PATH", "HOME", "HOSTNAME", "LANG", "LANGUAGE", "LC_ALL", "TZ", "TERM",
    # TLS trust and proxies, or the CLI can't reach its own API from some hosts.
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "no_proxy",
})

# Optional read-only DSN handed to the agent *as* DATABASE_URL, so a job can still
# inspect real data for analysis without holding the application's read/write
# credentials. Unset means the agent gets no database access at all.
AGENT_DATABASE_URL = os.environ.get("AGENT_DATABASE_URL", "")

# Image used for the detached deploy sibling. Defaults to this same image, which
# already carries git + bash + the docker CLI.
DEPLOY_IMAGE = os.environ.get("AGENT_RUNNER_IMAGE", "tillforty-agent-runner:local")

# CLI invocations, overridable so a flag rename upstream doesn't block a deploy.
# The prompt is appended as the final argument.
# --output-format json is what makes a run costable: the envelope carries
# total_cost_usd and the token counts alongside the text result.
CLAUDE_ARGS = os.environ.get(
    "AGENT_CLAUDE_ARGS", "-p --permission-mode bypassPermissions --output-format json"
).split()
CODEX_ARGS = os.environ.get(
    "AGENT_CODEX_ARGS", "exec --dangerously-bypass-approvals-and-sandbox"
).split()

# Where the agent leaves a question instead of guessing. Excluded from commits.
QUESTION_FILE = ".agent/QUESTION.md"

# Where the requester's screenshots/files are dropped for the agent to open.
# Inside the same excluded .agent/ directory, so they never reach the commit.
ATTACHMENT_DIR = ".agent/attachments"

LOG_LIMIT = 20000


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def tail(text: str, limit: int = LOG_LIMIT) -> str:
    if len(text) <= limit:
        return text
    return "…(truncated)…\n" + text[-limit:]


# ── Shell helpers ────────────────────────────────────────────────────────────
# The host checkout belongs to the server's own user, and the workspace changes
# hands between root and `agent` — both trip git's dubious-ownership guard.
# Everything git touches here is already inside our trust boundary.
GIT_SAFE_ENV = {
    "GIT_CONFIG_COUNT": "1",
    "GIT_CONFIG_KEY_0": "safe.directory",
    "GIT_CONFIG_VALUE_0": "*",
}


def run(cmd: list[str], cwd: str | None = None, env: dict | None = None,
        timeout: int = 300, user: str | None = None,
        inherit_env: bool = True) -> subprocess.CompletedProcess:
    """Run a command, capturing both streams. Never raises on non-zero exit.

    `inherit_env=False` starts from AGENT_ENV_KEEP rather than this container's
    environment — use it for anything running code we didn't write.
    """
    base = (
        dict(os.environ) if inherit_env
        else {k: v for k, v in os.environ.items() if k in AGENT_ENV_KEEP}
    )
    full_env = {**base, **GIT_SAFE_ENV, **(env or {})}
    kwargs: dict = {}
    if user:
        kwargs["user"] = user
        kwargs["group"] = user
        # HOME must follow the uid or the CLIs write config into /root.
        full_env["HOME"] = f"/home/{user}"
    try:
        return subprocess.run(
            cmd, cwd=cwd, env=full_env, capture_output=True, text=True,
            timeout=timeout, **kwargs,
        )
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        err = (exc.stderr or "") if isinstance(exc.stderr, str) else ""
        return subprocess.CompletedProcess(
            cmd, 124, out, err + f"\n[timed out after {timeout}s]"
        )
    except OSError as exc:
        # A missing binary — or, easier to hit, a `cwd` that doesn't exist because
        # the configured checkout path is wrong. Report it as an ordinary failed
        # command: callers already handle non-zero, whereas an exception here used
        # to escape all the way out and kill the heartbeat, making a mistyped path
        # look like "the runner is offline" instead of "checkout not found".
        return subprocess.CompletedProcess(cmd, 127, "", str(exc))


def git(args: list[str], cwd: str, token: str | None = None, **kw) -> subprocess.CompletedProcess:
    """git with the GitHub token injected as a credential helper.

    Passing the token via a helper (rather than baking it into the remote URL)
    keeps it out of `.git/config`, out of `git remote -v`, and out of any log.
    """
    cmd = ["git"]
    if token:
        helper = '!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; };f'
        cmd += ["-c", f"credential.helper={helper}"]
    cmd += args
    env = {"GH_TOKEN": token} if token else {}
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    return run(cmd, cwd=cwd, env=env, **kw)


# ── GitHub REST ──────────────────────────────────────────────────────────────
def gh_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def gh_post(token: str, path: str, body: dict) -> httpx.Response:
    async with httpx.AsyncClient(timeout=30) as c:
        return await c.post(f"{GITHUB_API}{path}", headers=gh_headers(token), json=body)


async def gh_put(token: str, path: str, body: dict) -> httpx.Response:
    async with httpx.AsyncClient(timeout=60) as c:
        return await c.put(f"{GITHUB_API}{path}", headers=gh_headers(token), json=body)


async def resolve_issue_via_sentry(issue_id: str) -> None:
    """Resolve an issue in Sentry/GlitchTip via its REST API."""
    org_slug = os.environ.get("SENTRY_ORG_SLUG", "").strip()
    project_slug = os.environ.get("SENTRY_PROJECT_SLUG", "").strip()
    api_token = os.environ.get("SENTRY_API_TOKEN", "").strip()
    api_url = os.environ.get("SENTRY_API_URL", "").strip().rstrip("/")

    if not api_url:
        api_url = "http://glitchtip:8080"

    if not (org_slug and project_slug and api_token):
        log(f"Cannot resolve issue {issue_id}: Sentry API not configured")
        return

    url = f"{api_url}/api/0/projects/{org_slug}/{project_slug}/issues/{issue_id}/"
    async with httpx.AsyncClient(timeout=15) as c:
        resp = await c.put(
            url,
            json={"status": "resolved"},
            headers={"Authorization": f"Bearer {api_token}"},
        )
        resp.raise_for_status()
        log(f"Auto-resolved issue {issue_id}")


# ── DB helpers ───────────────────────────────────────────────────────────────
async def get_secret(pool, name: str) -> str | None:
    return await pool.fetchval(
        "SELECT pgp_sym_decrypt(value, $2) FROM vault_secrets WHERE name = $1",
        name, VAULT_KEY,
    )


async def event(pool, job_id: int, kind: str, message: str) -> None:
    await pool.execute(
        "INSERT INTO dev_job_events (job_id, kind, message) VALUES ($1, $2, $3)",
        job_id, kind, message[:4000],
    )


def usage_of(agent: str, stdout: str) -> dict | None:
    """Cost and tokens for one CLI run, or None if we can't tell.

    Claude's `--output-format json` prints a single result envelope carrying
    `total_cost_usd` and a `usage` block. Codex reports its usage differently, so
    it stays unbilled rather than guessed at — a wrong number is worse than none.
    """
    if agent != "claude_code" or not (stdout or "").strip():
        return None
    try:
        data = json.loads(stdout)
    except ValueError:
        return None  # a plain-text run (AGENT_CLAUDE_ARGS overridden), not an error
    if isinstance(data, list):  # stream-json leaves a list of events
        data = next(
            (d for d in reversed(data) if isinstance(d, dict) and d.get("type") == "result"),
            None,
        )
    if not isinstance(data, dict):
        return None
    u = data.get("usage") or {}
    return {
        "cost_usd": float(data.get("total_cost_usd") or 0),
        "input_tokens": int(u.get("input_tokens") or 0),
        "output_tokens": int(u.get("output_tokens") or 0),
        "cache_read_tokens": int(u.get("cache_read_input_tokens") or 0),
        "result": data.get("result") or "",
    }


async def bill(pool, job_id: int, usage: dict | None, merge: bool = False) -> None:
    """Add one CLI run to a job's running total.

    Always `+`, never `=`: a job runs the CLI again for every answer round, every
    retry, and every conflict resolution, and all of it is the job's cost.
    """
    if not usage:
        return
    await pool.execute(
        """
        UPDATE dev_jobs SET
            cost_usd          = cost_usd + $2,
            input_tokens      = input_tokens + $3,
            output_tokens     = output_tokens + $4,
            cache_read_tokens = cache_read_tokens + $5,
            merge_cost_usd    = merge_cost_usd + $6,
            updated_at        = now()
        WHERE id = $1
        """,
        job_id, usage["cost_usd"], usage["input_tokens"], usage["output_tokens"],
        usage["cache_read_tokens"], usage["cost_usd"] if merge else 0,
    )


async def load_config(pool):
    return await pool.fetchrow("SELECT * FROM dev_settings WHERE id = 1")


async def resolve_agent_key(pool, provider: str) -> str | None:
    """API key of the credential bound to the development_agent function."""
    row = await pool.fetchrow(
        """
        SELECT c.id FROM ai_function_bindings b
        JOIN llm_credentials c ON c.id = b.credential_id
        WHERE b.function_key = 'development_agent' AND c.provider = $1
        """,
        provider,
    )
    if row is None:
        return None
    return await get_secret(pool, f"llm_credential:{row['id']}")


# ── Heartbeat ────────────────────────────────────────────────────────────────
def probe_host(checkout_path: str) -> dict:
    """What the API can't see: the checkout, the Docker socket, the CLIs.

    Surfaced in Settings › Development so "Validate access" can report on the
    deploy target rather than guessing.
    """
    info: dict = {"checkout_path": checkout_path}

    rev = run(["git", "rev-parse", "--is-inside-work-tree"], cwd=checkout_path, timeout=15)
    info["checkout_ok"] = rev.returncode == 0
    if info["checkout_ok"]:
        remote = run(["git", "remote", "get-url", "origin"], cwd=checkout_path, timeout=15)
        info["checkout_remote"] = remote.stdout.strip() if remote.returncode == 0 else None
        branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=checkout_path, timeout=15)
        info["checkout_branch"] = branch.stdout.strip() if branch.returncode == 0 else None

    info["has_docker"] = run(["docker", "version", "--format", "{{.Server.Version}}"], timeout=20).returncode == 0

    cli: dict = {}
    for name, cmd in (("claude", ["claude", "--version"]), ("codex", ["codex", "--version"])):
        p = run(cmd, timeout=30, user=AGENT_USER)
        cli[name] = p.stdout.strip() if p.returncode == 0 else None
    info["cli"] = cli
    return info


async def heartbeat(pool, cache: dict) -> None:
    """Refresh dev_settings.runner_seen_at every poll; re-probe the host rarely
    (a `docker version` per 5s would be pure noise)."""
    checkout = CHECKOUT_PATH
    now = datetime.now(timezone.utc).timestamp()
    if now - cache.get("at", 0) > 60 or cache.get("path") != checkout:
        cache["info"] = probe_host(checkout)
        cache["at"] = now
        cache["path"] = checkout
    await pool.execute(
        "UPDATE dev_settings SET runner_seen_at = now(), runner_info = $1::jsonb WHERE id = 1",
        json.dumps(cache["info"]),
    )


# ── Prompt attachments ───────────────────────────────────────────────────────
_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(name: str, index: int) -> str:
    """Sanitise a stored attachment name into a filename.

    Mirrors devagent._safe_name. The API already sanitises on upload; this
    repeats it because the value becomes a path here, and a row could have been
    written by something other than that endpoint.
    """
    base = os.path.basename((name or "").replace("\\", "/"))
    stem, _, suffix = base.rpartition(".")
    if not stem:
        stem, suffix = base, ""
    stem = _UNSAFE_NAME_CHARS.sub("_", stem).strip("._") or f"attachment-{index}"
    suffix = _UNSAFE_NAME_CHARS.sub("", suffix)[:16]
    return f"{stem[:100]}.{suffix}" if suffix else stem[:100]


async def write_attachments(pool, job_id: int, workdir: str) -> list[dict]:
    """Write the requester's screenshots/files into the workspace.

    They go under .agent/ — the same git-excluded directory as QUESTION.md — so
    an attachment can never end up in the commit, and are handed to AGENT_USER
    because the coding CLI runs unprivileged and has to open them. Re-written on
    every run, so they survive a question/answer round trip or a retry.
    """
    rows = await pool.fetch(
        "SELECT name, mime, size, data FROM dev_job_files WHERE job_id = $1 ORDER BY id",
        job_id,
    )
    if not rows:
        return []

    target = os.path.join(workdir, *ATTACHMENT_DIR.split("/"))
    os.makedirs(target, exist_ok=True)
    written: list[dict] = []
    used: set[str] = set()
    for index, row in enumerate(rows, start=1):
        name = safe_name(row["name"], index)
        # Two uploads can share a name; keep both rather than overwriting one.
        if name in used:
            stem, dot, suffix = name.partition(".")
            name = f"{stem}-{index}{dot}{suffix}"
        used.add(name)
        with open(os.path.join(target, name), "wb") as fh:
            fh.write(row["data"])
        written.append(
            {
                "path": f"{ATTACHMENT_DIR}/{name}",
                "mime": row["mime"] or "application/octet-stream",
                "size": row["size"],
            }
        )
    run(["chown", "-R", f"{AGENT_USER}:{AGENT_USER}", os.path.join(workdir, ".agent")], timeout=60)
    return written


def human_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size // 1024} KB"
    return f"{size / (1024 * 1024):.1f} MB"


async def _heartbeat_forever() -> None:
    """Own pool, own event loop — see start_heartbeat_thread."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    cache: dict = {}
    while True:
        try:
            await heartbeat(pool, cache)
        except Exception:  # noqa: BLE001 — liveness must outlive any single failure
            log("heartbeat error:\n" + traceback.format_exc())
        await asyncio.sleep(POLL_INTERVAL)


async def _deploy_forever() -> None:
    """Own pool, own event loop — see start_deploy_thread."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    while True:
        try:
            await reconcile_deployments(pool)
            job = await claim_merge_retry(pool)
            if job is not None:
                await retry_merge(pool, job)
                continue

            rel = await claim_release(pool)
            if rel is not None:
                await run_release(pool, rel)
                continue
        except Exception:  # noqa: BLE001 — deploys must outlive any single failure
            log("deploy worker error:\n" + traceback.format_exc())
        await asyncio.sleep(POLL_INTERVAL)


def start_deploy_thread() -> None:
    """Deploy on its own thread so a build in progress can't stall a release.

    Clicking Deploy used to do nothing visible whenever a job was running: the
    work loop was blocked inside a coding CLI, so the queued deployment sat
    unclaimed until the build finished — potentially the full AGENT_TIMEOUT.
    Merging a PR and launching the rebuild sibling is independent of whatever the
    agent is writing, so it gets its own worker. Claims use FOR UPDATE SKIP
    LOCKED, so the two threads can never take the same row.
    """
    def worker() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(_deploy_forever())

    threading.Thread(target=worker, name="deploy", daemon=True).start()


def start_heartbeat_thread() -> None:
    """Beat from a dedicated thread, independent of whatever the worker is doing.

    The work loop drives the coding CLIs through *blocking* subprocess calls that
    can hold the process for the whole AGENT_TIMEOUT. A heartbeat inside that
    loop therefore stops for the entire build, and the app declares the runner
    offline exactly while it is busiest — which also made the API refuse to queue
    a deploy mid-job. Liveness gets its own thread so it can never be starved by
    the work it is reporting on.
    """
    def worker() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(_heartbeat_forever())

    threading.Thread(target=worker, name="heartbeat", daemon=True).start()


# ── Prompt construction ──────────────────────────────────────────────────────
PREAMBLE = """\
You are an autonomous software engineer working inside a git checkout of {repo}.

Implement the following request end to end:

--- REQUEST ---
{prompt}
--- END REQUEST ---

Rules:
- Make the change directly in this working tree. Follow the conventions already
  present in the codebase.
- Do NOT run `git commit`, `git push`, or open a pull request. The harness
  commits, pushes, and opens the PR for you once you finish.
- Do not modify unrelated files, and keep the change focused on the request.
- If (and only if) you cannot proceed without a decision that only the requester
  can make, write your question — in plain language, no code — to the file
  `{question_file}` and then stop immediately without making any other change.
  Everything else you should decide yourself and keep going.
- When you are done, briefly summarise what you changed.
"""


ATTACHMENTS = """
The requester attached these files for context, already saved in this working
tree ({dir}/ is untracked, so never commit or move them):

{items}

Open them before you start — a screenshot is usually the screen to change.
"""


def build_prompt(repo: str, job, history: list, attachments: list[dict]) -> str:
    text = PREAMBLE.format(repo=repo, prompt=job["prompt"], question_file=QUESTION_FILE)
    if attachments:
        items = "\n".join(
            f"- {a['path']} ({a['mime']}, {human_size(a['size'])})" for a in attachments
        )
        text += ATTACHMENTS.format(dir=ATTACHMENT_DIR, items=items)
    if history:
        lines = ["", "Earlier in this job you asked, and the requester answered:", ""]
        for kind, message in history:
            label = "You asked" if kind == "question" else "Requester answered"
            lines.append(f"- {label}: {message}")
        lines.append("")
        lines.append("Use those answers and continue; do not ask them again.")
        text += "\n".join(lines)
    return text


# ── Job execution ────────────────────────────────────────────────────────────
async def claim_job(pool):
    return await pool.fetchrow(
        """
        UPDATE dev_jobs SET status = 'running',
                            started_at = COALESCE(started_at, now()),
                            attempts = attempts + 1,
                            updated_at = now()
        WHERE id = (
            SELECT id FROM dev_jobs WHERE status = 'pending'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def fail_job(pool, job_id: int, message: str, log_text: str = "") -> None:
    await pool.execute(
        """
        UPDATE dev_jobs SET status = 'failed', error = $2, log = $3,
                            finished_at = now(), updated_at = now()
        WHERE id = $1
        """,
        job_id, message[:2000], tail(log_text),
    )
    await event(pool, job_id, "failed", message)
    log(f"job {job_id} failed: {message}")


async def still_active(pool, job_id: int) -> bool:
    """The operator may have cancelled while the CLI was running."""
    status = await pool.fetchval("SELECT status FROM dev_jobs WHERE id = $1", job_id)
    return status == "running"


async def run_job(pool, job) -> None:
    job_id = job["id"]
    log(f"job {job_id} claimed ({job['agent']})")

    config = await load_config(pool)
    repo = config["repo_full_name"]
    base_branch = config["base_branch"]
    token = await get_secret(pool, TOKEN_SECRET_NAME)
    if not repo or not token:
        return await fail_job(pool, job_id, "Repository or GitHub token is not configured.")

    provider = "anthropic" if job["agent"] == "claude_code" else "openai"
    api_key = await resolve_agent_key(pool, provider)
    if not api_key:
        return await fail_job(
            pool, job_id,
            "No API key for the bound development agent. Check Settings › App › AI functions.",
        )

    workdir = os.path.join(WORKSPACE, f"job-{job_id}")
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir, exist_ok=True)
    shutil.chown(workdir, user=AGENT_USER, group=AGENT_USER)

    transcript: list[str] = []

    def record(step: str, proc: subprocess.CompletedProcess) -> None:
        transcript.append(
            f"$ {step}\n{proc.stdout or ''}{proc.stderr or ''}".rstrip()
        )

    try:
        # ── Clone + branch ──────────────────────────────────────────────────
        await event(pool, job_id, "clone", f"Cloning {repo}…")
        clone = git(
            ["clone", "--branch", base_branch, f"https://github.com/{repo}.git", "."],
            cwd=workdir, token=token, timeout=600,
        )
        record("git clone", clone)
        if clone.returncode != 0:
            return await fail_job(pool, job_id, "Could not clone the repository.", "\n".join(transcript))
        # The clone runs as root; hand the tree to the agent user.
        run(["chown", "-R", f"{AGENT_USER}:{AGENT_USER}", workdir], timeout=120)

        branch = job["branch"] or f"agent/job-{job_id}"
        co = git(["checkout", "-B", branch], cwd=workdir, timeout=60, user=AGENT_USER)
        record(f"git checkout -B {branch}", co)
        if co.returncode != 0:
            return await fail_job(pool, job_id, f"Could not create branch {branch}.", "\n".join(transcript))

        # The question file and the attachments are channels to/from the
        # operator, never part of the diff. Excluded before anything writes
        # there, so nothing in .agent/ can be picked up by `git add -A`.
        with open(os.path.join(workdir, ".git", "info", "exclude"), "a") as fh:
            fh.write("\n.agent/\n")

        # Re-materialised on every run; the queue event already named them, so
        # this stays out of the timeline.
        attachments = await write_attachments(pool, job_id, workdir)

        # ── Run the coding CLI ──────────────────────────────────────────────
        history = [
            (r["kind"], r["message"])
            for r in await pool.fetch(
                "SELECT kind, message FROM dev_job_events WHERE job_id = $1 "
                "AND kind IN ('question', 'answer') ORDER BY created_at, id",
                job_id,
            )
        ]
        prompt = build_prompt(repo, job, history, attachments)

        if job["agent"] == "claude_code":
            cmd = ["claude", *CLAUDE_ARGS]
            if job["model"]:
                cmd += ["--model", job["model"]]
            env = {"ANTHROPIC_API_KEY": api_key}
        else:
            cmd = ["codex", *CODEX_ARGS]
            if job["model"]:
                cmd += ["--model", job["model"]]
            env = {"OPENAI_API_KEY": api_key}
        if AGENT_DATABASE_URL:
            env["DATABASE_URL"] = AGENT_DATABASE_URL
        cmd.append(prompt)

        await event(pool, job_id, "agent", f"Running {job['agent']} in auto mode…")
        log(f"job {job_id}: {' '.join(cmd[:-1])} <prompt>")
        # inherit_env=False: the agent sees AGENT_ENV_KEEP plus what's set here,
        # never this container's secrets.
        proc = run(cmd, cwd=workdir, env=env, timeout=AGENT_TIMEOUT, user=AGENT_USER,
                   inherit_env=False)
        usage = usage_of(job["agent"], proc.stdout)
        await bill(pool, job_id, usage)
        if usage and usage["result"]:
            # The transcript is read by humans in the job dialog — keep the text
            # result rather than the JSON envelope it now arrives in. Only when
            # there IS one: an envelope without `result` must not blank the log.
            proc.stdout = usage["result"]
        record(" ".join(cmd[:-1]) + " <prompt>", proc)

        if not await still_active(pool, job_id):
            log(f"job {job_id} was cancelled while running — discarding result")
            return

        # ── Did it ask a question instead of guessing? ──────────────────────
        question_path = os.path.join(workdir, QUESTION_FILE)
        if os.path.exists(question_path):
            with open(question_path) as fh:
                question = fh.read().strip()
            if question:
                await pool.execute(
                    """
                    UPDATE dev_jobs SET status = 'answer_pending', question = $2,
                                        log = $3, updated_at = now()
                    WHERE id = $1
                    """,
                    job_id, question[:4000], tail("\n".join(transcript)),
                )
                await event(pool, job_id, "question", question[:4000])
                log(f"job {job_id} is waiting for an answer")
                return

        if proc.returncode != 0:
            return await fail_job(
                pool, job_id,
                f"The {job['agent']} run exited with code {proc.returncode}.",
                "\n".join(transcript),
            )

        # ── Commit, push, open the PR ───────────────────────────────────────
        status_proc = git(["status", "--porcelain"], cwd=workdir, timeout=60, user=AGENT_USER)
        if not status_proc.stdout.strip():
            return await fail_job(
                pool, job_id,
                "The agent finished without changing any files.",
                "\n".join(transcript),
            )

        git(["config", "user.email", AGENT_GIT_EMAIL], cwd=workdir, timeout=30, user=AGENT_USER)
        git(["config", "user.name", AGENT_GIT_NAME], cwd=workdir, timeout=30, user=AGENT_USER)
        add = git(["add", "-A"], cwd=workdir, timeout=120, user=AGENT_USER)
        record("git add -A", add)
        commit = git(
            ["commit", "-m", job["title"][:72], "-m", job["prompt"][:2000]],
            cwd=workdir, timeout=120, user=AGENT_USER,
        )
        record("git commit", commit)
        if commit.returncode != 0:
            return await fail_job(pool, job_id, "Could not commit the agent's changes.", "\n".join(transcript))

        sha = git(["rev-parse", "HEAD"], cwd=workdir, timeout=30, user=AGENT_USER).stdout.strip()

        push = git(["push", "--force-with-lease", "origin", branch], cwd=workdir, token=token, timeout=600)
        record(f"git push origin {branch}", push)
        if push.returncode != 0:
            return await fail_job(pool, job_id, "Could not push the branch to GitHub.", "\n".join(transcript))

        await event(pool, job_id, "push", f"Pushed {branch} ({sha[:8]}).")

        body = (
            f"Automated by the Tillforty development agent (job #{job_id}).\n\n"
            f"**Request**\n\n{job['prompt']}\n"
        )
        if attachments:
            # The files themselves stay out of the repo; the names tell a reviewer
            # the agent had more to go on than the prompt.
            names = ", ".join(f"`{os.path.basename(a['path'])}`" for a in attachments)
            body += f"\n**Attachments**: {names}\n"
        pr = await gh_post(
            token, f"/repos/{repo}/pulls",
            {"title": job["title"][:250], "head": branch, "base": base_branch, "body": body[:60000]},
        )
        if pr.status_code == 422 and "already exists" in pr.text:
            # Re-run of a job whose PR is still open — reuse it.
            async with httpx.AsyncClient(timeout=30) as c:
                owner = repo.split("/")[0]
                existing = await c.get(
                    f"{GITHUB_API}/repos/{repo}/pulls",
                    headers=gh_headers(token),
                    params={"head": f"{owner}:{branch}", "state": "open"},
                )
            items = existing.json() if existing.status_code == 200 else []
            if not items:
                return await fail_job(pool, job_id, f"GitHub rejected the pull request: {pr.text[:500]}", "\n".join(transcript))
            pr_json = items[0]
        elif pr.status_code not in (200, 201):
            return await fail_job(
                pool, job_id,
                f"GitHub returned {pr.status_code} when opening the pull request.",
                "\n".join(transcript) + f"\n{pr.text[:2000]}",
            )
        else:
            pr_json = pr.json()

        await pool.execute(
            """
            UPDATE dev_jobs
            SET status = 'deployment_ready', branch = $2, pr_number = $3, pr_url = $4,
                commit_sha = $5, error = NULL, question = NULL, log = $6,
                finished_at = now(), updated_at = now()
            WHERE id = $1
            """,
            job_id, branch, pr_json["number"], pr_json["html_url"], sha,
            tail("\n".join(transcript)),
        )
        await event(pool, job_id, "pr", f"Opened PR #{pr_json['number']}.")
        log(f"job {job_id} → PR #{pr_json['number']}")

        # Merge straight away. The job is "built" once it is on the base branch;
        # shipping it is a separate, batched decision the operator makes later.
        merged_job = await pool.fetchrow("SELECT * FROM dev_jobs WHERE id = $1", job_id)
        ok, merge_sha, detail = await merge_pr(pool, merged_job, repo, token, base_branch)
        if ok:
            await pool.execute(
                """
                UPDATE dev_jobs SET status = 'merged', commit_sha = COALESCE($2, commit_sha),
                                    merged_at = now(), error = NULL, updated_at = now()
                WHERE id = $1
                """,
                job_id, merge_sha,
            )
            await event(pool, job_id, "merged",
                        f"Merged PR #{pr_json['number']} — waiting for the next release.")
            log(f"job {job_id} merged (PR #{pr_json['number']})")
        else:
            # The PR stands; it just needs a human. 'deployment_ready' now means
            # exactly that: open, not merged.
            await pool.execute(
                "UPDATE dev_jobs SET error = $2, updated_at = now() WHERE id = $1",
                job_id, detail[:2000],
            )
            await event(pool, job_id, "failed", detail)
            log(f"job {job_id}: auto-merge failed — {detail}")

    except Exception:  # noqa: BLE001 — a crash here must not kill the worker
        await fail_job(pool, job_id, "The runner crashed while processing this job.",
                       "\n".join(transcript) + "\n" + traceback.format_exc())
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ── Deployments ──────────────────────────────────────────────────────────────
DEPLOY_SCRIPT = """\
set -eux
git config --global --add safe.directory "$CHECKOUT"
cd "$CHECKOUT"
# This container is root, but the checkout belongs to the server's own user.
# Anything git writes here (objects, FETCH_HEAD, index) would otherwise end up
# root-owned and lock that user out of their own repo on the next command, so
# remember the owner now and hand everything back on the way out.
CHECKOUT_OWNER="$(stat -c '%u:%g' "$CHECKOUT")"
trap 'chown -R "$CHECKOUT_OWNER" "$CHECKOUT" || true' EXIT
git -c credential.helper='!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; };f' \
    fetch origin "$BASE_BRANCH"
git checkout "$BASE_BRANCH"
git -c credential.helper='!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; };f' \
    pull --ff-only origin "$BASE_BRANCH"
./start.sh
"""


CONFLICT_PROMPT = """\
You are resolving a git merge conflict, nothing else.

The branch `{branch}` was written to satisfy this request:

--- ORIGINAL REQUEST ---
{prompt}
--- END REQUEST ---

Meanwhile `{base}` moved on, and merging it in produced conflicts in:
{files}

Resolve every conflict so that BOTH intents survive: keep the change that landed
on `{base}`, and keep this branch's work on top of it. Do not drop either side
just to make the file parse, and do not "resolve" by reverting to one side unless
the two genuinely describe the same change.

Rules:
- Remove every conflict marker (<<<<<<<, =======, >>>>>>>).
- Change nothing beyond what the conflicts require.
- Do NOT run git commands. The harness commits and pushes for you.
"""


async def resolve_conflicts(pool, job, repo: str, token: str, base_branch: str) -> tuple[bool, str]:
    """Merge the base branch into the PR branch, letting the coding agent settle
    any conflicts, then push. Returns (resolved, detail).

    Why this belongs to deploy: two jobs branched from the same commit are always
    mergeable individually, and the first merge is what makes the second one
    conflict. That only surfaces at deploy time, so the fix has to live here.
    """
    job_id = job["id"]
    if not job["branch"]:
        return False, "The job has no branch, so the conflict can't be resolved."

    provider = "anthropic" if job["agent"] == "claude_code" else "openai"
    api_key = await resolve_agent_key(pool, provider)
    if not api_key:
        return False, "No agent API key available to resolve the conflict."

    branch = job["branch"]
    workdir = os.path.join(WORKSPACE, f"conflict-{job_id}")
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir, exist_ok=True)
    shutil.chown(workdir, user=AGENT_USER, group=AGENT_USER)
    try:
        clone = git(["clone", "--branch", branch, f"https://github.com/{repo}.git", "."],
                    cwd=workdir, token=token, timeout=600)
        if clone.returncode != 0:
            return False, "Could not clone the branch to resolve the conflict."
        run(["chown", "-R", f"{AGENT_USER}:{AGENT_USER}", workdir], timeout=120)
        git(["config", "user.email", AGENT_GIT_EMAIL], cwd=workdir, timeout=30, user=AGENT_USER)
        git(["config", "user.name", AGENT_GIT_NAME], cwd=workdir, timeout=30, user=AGENT_USER)

        fetch = git(["fetch", "origin", base_branch], cwd=workdir, token=token, timeout=300)
        if fetch.returncode != 0:
            return False, f"Could not fetch {base_branch}."

        merge = git(["merge", f"origin/{base_branch}", "--no-edit"], cwd=workdir,
                    timeout=300, user=AGENT_USER)
        if merge.returncode == 0:
            # Base merged cleanly — the branch was merely stale, not conflicted.
            push = git(["push", "origin", branch], cwd=workdir, token=token, timeout=600)
            if push.returncode != 0:
                return False, "Could not push the updated branch."
            return True, f"Brought {branch} up to date with {base_branch}."

        conflicted = [
            ln.strip() for ln in
            git(["diff", "--name-only", "--diff-filter=U"], cwd=workdir, timeout=60,
                user=AGENT_USER).stdout.splitlines() if ln.strip()
        ]
        if not conflicted:
            return False, "Merge failed but reported no conflicted files."

        await event(pool, job_id, "conflict",
                    f"Merge conflict in {len(conflicted)} file(s); asking the agent to resolve.")

        prompt = CONFLICT_PROMPT.format(
            branch=branch, base=base_branch, prompt=job["prompt"],
            files="\n".join(f"- {f}" for f in conflicted),
        )
        if job["agent"] == "claude_code":
            cmd = ["claude", *CLAUDE_ARGS]
            env = {"ANTHROPIC_API_KEY": api_key}
        else:
            cmd = ["codex", *CODEX_ARGS]
            env = {"OPENAI_API_KEY": api_key}
        if job["model"]:
            cmd += ["--model", job["model"]]
        cmd.append(prompt)

        # inherit_env=False for the same reason as the main run: this is the other
        # place we execute LLM-written code.
        proc = run(cmd, cwd=workdir, env=env, timeout=AGENT_TIMEOUT, user=AGENT_USER,
                   inherit_env=False)
        # Conflict resolution is work the job caused, so it lands on the job's bill
        # — kept as its own column so merge overhead stays visible.
        await bill(pool, job_id, usage_of(job["agent"], proc.stdout), merge=True)
        if proc.returncode != 0:
            return False, f"The agent exited {proc.returncode} while resolving the conflict."

        # Never ship a file that still carries markers, whatever the agent claims.
        # Scan ONLY the files that were conflicted, and match only the two markers
        # git always writes with a label after them. A bare `=======` line is not
        # evidence: it is ordinary Markdown heading underlining, which made this
        # check fail resolutions that were in fact correct.
        left = git(["diff", "--name-only", "--diff-filter=U"], cwd=workdir, timeout=60,
                   user=AGENT_USER).stdout.strip()
        still_marked = [
            f for f in conflicted
            if run(["grep", "-lE", r"^(<{7}|>{7}) ", os.path.join(workdir, f)],
                   timeout=30).returncode == 0
        ]
        if left or still_marked:
            detail = ", ".join(still_marked) if still_marked else left.replace("\n", ", ")
            return False, f"Conflict markers were still present after the agent ran ({detail})."

        git(["add", "-A"], cwd=workdir, timeout=120, user=AGENT_USER)
        commit = git(["commit", "-m", f"Merge {base_branch} into {branch} (conflicts resolved by agent)"],
                     cwd=workdir, timeout=120, user=AGENT_USER)
        if commit.returncode != 0 and "nothing to commit" not in (commit.stdout + commit.stderr):
            return False, "Could not commit the resolved merge."
        push = git(["push", "origin", branch], cwd=workdir, token=token, timeout=600)
        if push.returncode != 0:
            return False, "Could not push the resolved branch."
        await event(pool, job_id, "conflict", "Conflicts resolved and pushed.")
        return True, f"Resolved conflicts in {len(conflicted)} file(s)."
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def merge_pr(pool, job, repo: str, token: str, base_branch: str) -> tuple[bool, str | None, str]:
    """Merge a finished job's PR into the base branch. Returns (ok, sha, detail).

    Merging happens as soon as the agent finishes, not at deploy time. Two jobs
    branched from the same commit are each mergeable on their own, and it is the
    FIRST merge that strands the second — so merging early, one job at a time,
    keeps conflicts small and lets the agent resolve them while its work is still
    the only thing in flight.
    """
    job_id, pr_number = job["id"], job["pr_number"]
    if pr_number is None:
        return False, None, "The job has no pull request to merge."

    async with httpx.AsyncClient(timeout=30) as c:
        current = await c.get(
            f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}", headers=gh_headers(token)
        )
    if current.status_code == 200 and current.json().get("merged"):
        return True, current.json().get("merge_commit_sha"), "Already merged."

    merge_body = {
        "merge_method": os.environ.get("AGENT_MERGE_METHOD", "squash"),
        "commit_title": f"PR #{pr_number}: {job['title']}"[:250],
    }
    merge = await gh_put(token, f"/repos/{repo}/pulls/{pr_number}/merge", merge_body)

    if merge.status_code != 200:
        detail = merge.json().get("message", merge.text[:300]) if merge.text else merge.text
        if "conflict" not in detail.lower() and merge.status_code != 405:
            return False, None, f"GitHub refused to merge PR #{pr_number}: {detail}"

        log(f"job {job_id}: PR #{pr_number} conflicts — resolving")
        await event(pool, job_id, "conflict", "Merge conflict; the agent is resolving it…")
        resolved, why = await resolve_conflicts(pool, job, repo, token, base_branch)
        if not resolved:
            return False, None, f"PR #{pr_number} has conflicts that couldn't be resolved: {why}"

        # GitHub recomputes mergeability asynchronously after a push.
        merge = None
        for _ in range(10):
            await asyncio.sleep(3)
            async with httpx.AsyncClient(timeout=30) as c:
                pr = await c.get(
                    f"{GITHUB_API}/repos/{repo}/pulls/{pr_number}", headers=gh_headers(token)
                )
            if pr.status_code == 200 and pr.json().get("mergeable") is True:
                merge = await gh_put(token, f"/repos/{repo}/pulls/{pr_number}/merge", merge_body)
                break
        if merge is None or merge.status_code != 200:
            again = merge.json().get("message", "") if merge is not None and merge.text else "still not mergeable"
            return False, None, f"PR #{pr_number} wouldn't merge after resolving: {again}"

    return True, merge.json().get("sha"), "Merged."


async def claim_merge_retry(pool):
    """A job whose auto-merge failed and that an operator asked to retry."""
    return await pool.fetchrow(
        """
        UPDATE dev_jobs SET merge_requested = false, updated_at = now()
        WHERE id = (
            SELECT id FROM dev_jobs
            WHERE merge_requested AND status = 'deployment_ready' AND pr_number IS NOT NULL
            ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def retry_merge(pool, job) -> None:
    """Re-attempt the merge (conflicts and all) for a job that needed a nudge."""
    job_id = job["id"]
    log(f"job {job_id}: retrying merge of PR #{job['pr_number']}")
    config = await load_config(pool)
    token = await get_secret(pool, TOKEN_SECRET_NAME)
    repo = config["repo_full_name"]
    if not repo or not token:
        await pool.execute(
            "UPDATE dev_jobs SET error = $2, updated_at = now() WHERE id = $1",
            job_id, "Repository or GitHub token is not configured.",
        )
        return
    ok, merge_sha, detail = await merge_pr(pool, job, repo, token, config["base_branch"])
    if ok:
        await pool.execute(
            """
            UPDATE dev_jobs SET status = 'merged', commit_sha = COALESCE($2, commit_sha),
                                merged_at = now(), error = NULL, updated_at = now()
            WHERE id = $1
            """,
            job_id, merge_sha,
        )
        await event(pool, job_id, "merged", "Merged — waiting for the next release.")
    else:
        await pool.execute(
            "UPDATE dev_jobs SET error = $2, updated_at = now() WHERE id = $1",
            job_id, detail[:2000],
        )
        await event(pool, job_id, "failed", detail)
    log(f"job {job_id}: merge retry {'succeeded' if ok else 'failed'}")


async def claim_release(pool):
    """Releases are the only kind of deployment now: rebuild whatever is on the
    base branch and stamp every merged job as shipped."""
    return await pool.fetchrow(
        """
        UPDATE dev_deployments SET status = 'deploying'
        WHERE id = (
            SELECT id FROM dev_deployments WHERE status = 'pending'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def finish_release(pool, rel_id: int, ok: bool, error: str | None = None,
                         log_text: str = "") -> None:
    """Close out a release and move every job it covered to its final state."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE dev_deployments SET status = $2, error = $3, log = $4, finished_at = now()
                WHERE id = $1
                """,
                rel_id, "deployed" if ok else "failed", (error or None), tail(log_text),
            )
            if ok:
                await conn.execute(
                    """
                    UPDATE dev_jobs SET status = 'deployed', error = NULL, updated_at = now()
                    WHERE release_id = $1
                    """,
                    rel_id,
                )
                # Auto-resolve issues for deployed jobs that have an issue_id
                jobs_with_issues = await conn.fetch(
                    """
                    SELECT id, issue_id FROM dev_jobs
                    WHERE release_id = $1 AND issue_id IS NOT NULL
                    """,
                    rel_id,
                )
                for job in jobs_with_issues:
                    try:
                        await resolve_issue_via_sentry(job["issue_id"])
                    except Exception as e:
                        log(f"Failed to auto-resolve issue {job['issue_id']}: {e}")
            else:
                # A failed release puts its jobs back in the queue rather than
                # stranding them in 'deploying' — they are still merged.
                await conn.execute(
                    """
                    UPDATE dev_jobs SET status = 'merged', release_id = NULL,
                                        error = $2, updated_at = now()
                    WHERE release_id = $1
                    """,
                    rel_id, error,
                )
    jobs = await pool.fetch("SELECT id FROM dev_jobs WHERE release_id = $1", rel_id)
    for j in jobs:
        await event(pool, j["id"], "deployed" if ok else "failed",
                    "Deployed." if ok else f"Release failed: {error}")
    log(f"release {rel_id} {'succeeded' if ok else 'failed'}")


async def run_release(pool, rel) -> None:
    """Pull the base branch and rebuild the stack once, for every merged job."""
    rel_id = rel["id"]
    log(f"release {rel_id} claimed ({rel['job_count']} job(s))")

    config = await load_config(pool)
    token = await get_secret(pool, TOKEN_SECRET_NAME)
    if not config["deploy_enabled"]:
        return await finish_release(pool, rel_id, False, "Deploy is switched off.")
    if not token:
        return await finish_release(pool, rel_id, False, "GitHub token is not configured.")

    try:
        checkout = CHECKOUT_PATH
        container_name = f"tillforty-deploy-{rel_id}"
        run(["docker", "rm", "-f", container_name], timeout=60)
        # NOT --rm: the exit code must survive for reconcile_deployments to read,
        # since ./start.sh restarts this very runner mid-deploy.
        started = run(
            [
                "docker", "run", "-d", "--name", container_name,
                # start.sh finishes by polling http://localhost:$API_PORT/ready.
                # In its own network namespace that loopback is the container's,
                # not the host's, so the check could never pass and every deploy
                # burned the full readiness timeout before reporting success.
                "--network", "host",
                "-v", "/var/run/docker.sock:/var/run/docker.sock",
                "-v", f"{checkout}:{checkout}",
                "-e", f"CHECKOUT={checkout}",
                "-e", f"BASE_BRANCH={config['base_branch']}",
                "-e", f"GH_TOKEN={token}",
                "-w", checkout,
                DEPLOY_IMAGE, "bash", "-lc", DEPLOY_SCRIPT,
            ],
            timeout=120,
        )
        if started.returncode != 0:
            return await finish_release(
                pool, rel_id, False, "Could not start the deploy container.",
                started.stdout + started.stderr,
            )
        container_id = started.stdout.strip()
        await pool.execute(
            "UPDATE dev_deployments SET container_id = $2 WHERE id = $1", rel_id, container_id
        )
        log(f"release {rel_id}: rebuild running in {container_name} ({container_id[:12]})")
        # From here on it's reconcile_deployments' job — this process may be
        # restarted by the very rebuild it just launched.
    except Exception:  # noqa: BLE001
        await finish_release(pool, rel_id, False,
                             "The runner crashed while deploying.", traceback.format_exc())


async def reconcile_deployments(pool) -> None:
    """Pick up deploy containers that finished — including across our own restart."""
    rows = await pool.fetch(
        "SELECT * FROM dev_deployments WHERE status = 'deploying' AND container_id IS NOT NULL"
    )
    for dep in rows:
        cid = dep["container_id"]
        inspect = run(
            ["docker", "inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", cid], timeout=60
        )
        if inspect.returncode != 0:
            await finish_release(pool, dep["id"], False,
                                 "The deploy container disappeared before it reported a result.")
            continue
        state, _, code = inspect.stdout.strip().partition(" ")
        if state == "running":
            age = (datetime.now(timezone.utc) - dep["created_at"]).total_seconds()
            if age > DEPLOY_TIMEOUT:
                run(["docker", "rm", "-f", cid], timeout=60)
                await finish_release(pool, dep["id"], False,
                                     f"The deploy timed out after {DEPLOY_TIMEOUT}s.")
            continue
        logs = run(["docker", "logs", "--tail", "400", cid], timeout=60)
        ok = code.strip() == "0"
        await finish_release(
            pool, dep["id"], ok,
            None if ok else f"The rebuild exited with code {code.strip()}.",
            logs.stdout + logs.stderr,
        )
        run(["docker", "rm", "-f", cid], timeout=60)


# ── Main loop ────────────────────────────────────────────────────────────────
async def main() -> None:
    log("development agent runner starting")
    os.makedirs(WORKSPACE, exist_ok=True)
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    start_heartbeat_thread()
    start_deploy_thread()

    # Work left mid-flight by a crash — or by the rebuild that restarted us —
    # would otherwise sit in a non-terminal status forever. Both are safe to
    # re-queue: a job re-clones from scratch, and a deployment re-checks the
    # PR's merge state before touching it.
    log("re-queue on startup: " + await pool.execute(
        "UPDATE dev_jobs SET status = 'pending', updated_at = now() WHERE status = 'running'"
    ))
    log("re-queue on startup: " + await pool.execute(
        "UPDATE dev_deployments SET status = 'pending' WHERE status = 'merging'"
    ))

    while True:
        try:
            job = await claim_job(pool)
            if job is not None:
                await run_job(pool, job)
                continue

            await asyncio.sleep(POLL_INTERVAL)
        except asyncpg.PostgresError as exc:
            log(f"database error: {exc}")
            await asyncio.sleep(POLL_INTERVAL)
        except Exception:  # noqa: BLE001 — the loop must outlive any single failure
            log("unexpected error:\n" + traceback.format_exc())
            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
