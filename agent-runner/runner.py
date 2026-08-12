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

# Image used for the detached deploy sibling. Defaults to this same image, which
# already carries git + bash + the docker CLI.
DEPLOY_IMAGE = os.environ.get("AGENT_RUNNER_IMAGE", "tillforty-agent-runner:local")

# CLI invocations, overridable so a flag rename upstream doesn't block a deploy.
# The prompt is appended as the final argument.
CLAUDE_ARGS = os.environ.get(
    "AGENT_CLAUDE_ARGS", "-p --permission-mode bypassPermissions"
).split()
CODEX_ARGS = os.environ.get(
    "AGENT_CODEX_ARGS", "exec --dangerously-bypass-approvals-and-sandbox"
).split()

# Where the agent leaves a question instead of guessing. Excluded from commits.
QUESTION_FILE = ".agent/QUESTION.md"

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
        timeout: int = 300, user: str | None = None) -> subprocess.CompletedProcess:
    """Run a command, capturing both streams. Never raises on non-zero exit."""
    full_env = {**os.environ, **GIT_SAFE_ENV, **(env or {})}
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
            dep = await claim_deployment(pool)
            if dep is not None:
                await run_deployment(pool, dep)
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


def build_prompt(repo: str, job, history: list) -> str:
    text = PREAMBLE.format(repo=repo, prompt=job["prompt"], question_file=QUESTION_FILE)
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

        # The question file is a channel to the operator, never part of the diff.
        with open(os.path.join(workdir, ".git", "info", "exclude"), "a") as fh:
            fh.write("\n.agent/\n")

        # ── Run the coding CLI ──────────────────────────────────────────────
        history = [
            (r["kind"], r["message"])
            for r in await pool.fetch(
                "SELECT kind, message FROM dev_job_events WHERE job_id = $1 "
                "AND kind IN ('question', 'answer') ORDER BY created_at, id",
                job_id,
            )
        ]
        prompt = build_prompt(repo, job, history)

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
        cmd.append(prompt)

        await event(pool, job_id, "agent", f"Running {job['agent']} in auto mode…")
        log(f"job {job_id}: {' '.join(cmd[:-1])} <prompt>")
        proc = run(cmd, cwd=workdir, env=env, timeout=AGENT_TIMEOUT, user=AGENT_USER)
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

        git(["config", "user.email", "agent@tillforty.local"], cwd=workdir, timeout=30, user=AGENT_USER)
        git(["config", "user.name", "Tillforty development agent"], cwd=workdir, timeout=30, user=AGENT_USER)
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


async def resolve_conflicts(pool, dep, repo: str, token: str, base_branch: str) -> tuple[bool, str]:
    """Merge the base branch into the PR branch, letting the coding agent settle
    any conflicts, then push. Returns (resolved, detail).

    Why this belongs to deploy: two jobs branched from the same commit are always
    mergeable individually, and the first merge is what makes the second one
    conflict. That only surfaces at deploy time, so the fix has to live here.
    """
    job_id = dep["job_id"]
    if job_id is None:
        return False, "Deployment has no job to rebuild from."
    job = await pool.fetchrow("SELECT * FROM dev_jobs WHERE id = $1", job_id)
    if job is None or not job["branch"]:
        return False, "Job or branch is gone, so the conflict can't be resolved."

    provider = "anthropic" if job["agent"] == "claude_code" else "openai"
    api_key = await resolve_agent_key(pool, provider)
    if not api_key:
        return False, "No agent API key available to resolve the conflict."

    branch = job["branch"]
    workdir = os.path.join(WORKSPACE, f"conflict-{dep['id']}")
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir, exist_ok=True)
    shutil.chown(workdir, user=AGENT_USER, group=AGENT_USER)
    try:
        clone = git(["clone", "--branch", branch, f"https://github.com/{repo}.git", "."],
                    cwd=workdir, token=token, timeout=600)
        if clone.returncode != 0:
            return False, "Could not clone the branch to resolve the conflict."
        run(["chown", "-R", f"{AGENT_USER}:{AGENT_USER}", workdir], timeout=120)
        git(["config", "user.email", "agent@tillforty.local"], cwd=workdir, timeout=30, user=AGENT_USER)
        git(["config", "user.name", "Tillforty development agent"], cwd=workdir, timeout=30, user=AGENT_USER)

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

        proc = run(cmd, cwd=workdir, env=env, timeout=AGENT_TIMEOUT, user=AGENT_USER)
        if proc.returncode != 0:
            return False, f"The agent exited {proc.returncode} while resolving the conflict."

        # Never ship a file that still carries markers, whatever the agent claims.
        left = git(["diff", "--name-only", "--diff-filter=U"], cwd=workdir, timeout=60,
                   user=AGENT_USER).stdout.strip()
        grep = run(["grep", "-rlE", r"^(<{7}|={7}|>{7})( |$)", workdir, "--exclude-dir=.git"],
                   timeout=120)
        if left or grep.stdout.strip():
            return False, "Conflict markers were still present after the agent ran."

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


async def claim_deployment(pool):
    return await pool.fetchrow(
        """
        UPDATE dev_deployments SET status = 'merging'
        WHERE id = (
            SELECT id FROM dev_deployments WHERE status = 'pending'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def finish_deployment(pool, dep_id: int, job_id: int | None, ok: bool,
                            error: str | None = None, log_text: str = "") -> None:
    await pool.execute(
        """
        UPDATE dev_deployments SET status = $2, error = $3, log = $4, finished_at = now()
        WHERE id = $1
        """,
        dep_id, "deployed" if ok else "failed", (error or None), tail(log_text),
    )
    if job_id is not None:
        # A failed deploy leaves the PR ready to try again, not stuck "deploying".
        await pool.execute(
            """
            UPDATE dev_jobs SET status = $2, error = $3, updated_at = now()
            WHERE id = $1
            """,
            job_id, "deployed" if ok else "deployment_ready", (None if ok else error),
        )
        await event(pool, job_id, "deployed" if ok else "failed",
                    "Deployed." if ok else f"Deploy failed: {error}")
    log(f"deployment {dep_id} {'succeeded' if ok else 'failed'}")


async def run_deployment(pool, dep) -> None:
    """Merge the PR, then hand the host rebuild to a detached sibling container."""
    dep_id, job_id = dep["id"], dep["job_id"]
    log(f"deployment {dep_id} claimed (PR #{dep['pr_number']})")

    config = await load_config(pool)
    repo = config["repo_full_name"]
    token = await get_secret(pool, TOKEN_SECRET_NAME)
    if not repo or not token:
        return await finish_deployment(pool, dep_id, job_id, False,
                                       "Repository or GitHub token is not configured.")
    if not config["deploy_enabled"]:
        return await finish_deployment(pool, dep_id, job_id, False, "Deploy is switched off.")

    job_title = None
    if job_id is not None:
        job_title = await pool.fetchval("SELECT title FROM dev_jobs WHERE id = $1", job_id)

    try:
        # Merging is the one step that isn't safely repeatable, so check first.
        # This also makes recovery cheap: a run interrupted between the merge and
        # the rebuild is simply re-claimed and picks up from here.
        async with httpx.AsyncClient(timeout=30) as c:
            current = await c.get(
                f"{GITHUB_API}/repos/{repo}/pulls/{dep['pr_number']}", headers=gh_headers(token)
            )
        already_merged = current.status_code == 200 and current.json().get("merged")

        if already_merged:
            merge_sha = current.json().get("merge_commit_sha")
            log(f"deployment {dep_id}: PR #{dep['pr_number']} was already merged")
        else:
            merge = await gh_put(
                token, f"/repos/{repo}/pulls/{dep['pr_number']}/merge",
                {
                    "merge_method": os.environ.get("AGENT_MERGE_METHOD", "squash"),
                    "commit_title": f"{dep['version_label']}: {job_title or 'agent change'}"[:250],
                },
            )
            if merge.status_code != 200:
                detail = merge.json().get("message", merge.text[:300]) if merge.text else merge.text
                # A conflict here is the normal cost of two jobs branching from
                # the same commit: whichever merges first strands the other. Send
                # the agent back in to settle it, then merge again.
                if "conflict" in detail.lower() or merge.status_code == 405:
                    log(f"deployment {dep_id}: PR #{dep['pr_number']} conflicts — resolving")
                    await pool.execute(
                        "UPDATE dev_deployments SET error = $2 WHERE id = $1",
                        dep_id, "Merge conflict — the agent is resolving it…",
                    )
                    resolved, why = await resolve_conflicts(
                        pool, dep, repo, token, config["base_branch"]
                    )
                    if not resolved:
                        return await finish_deployment(
                            pool, dep_id, job_id, False,
                            f"PR #{dep['pr_number']} has conflicts that couldn't be resolved: {why}",
                        )
                    # GitHub recomputes mergeability asynchronously after a push.
                    merge = None
                    for attempt in range(10):
                        await asyncio.sleep(3)
                        async with httpx.AsyncClient(timeout=30) as c:
                            pr = await c.get(
                                f"{GITHUB_API}/repos/{repo}/pulls/{dep['pr_number']}",
                                headers=gh_headers(token),
                            )
                        if pr.status_code == 200 and pr.json().get("mergeable") is True:
                            merge = await gh_put(
                                token, f"/repos/{repo}/pulls/{dep['pr_number']}/merge",
                                {
                                    "merge_method": os.environ.get("AGENT_MERGE_METHOD", "squash"),
                                    "commit_title":
                                        f"{dep['version_label']}: {job_title or 'agent change'}"[:250],
                                },
                            )
                            break
                    if merge is None or merge.status_code != 200:
                        again = (
                            merge.json().get("message", "")
                            if merge is not None and merge.text else "still not mergeable"
                        )
                        return await finish_deployment(
                            pool, dep_id, job_id, False,
                            f"PR #{dep['pr_number']} still wouldn't merge after resolving: {again}",
                        )
                    await pool.execute(
                        "UPDATE dev_deployments SET error = NULL WHERE id = $1", dep_id
                    )
                    if job_id is not None:
                        await event(pool, job_id, "conflict", why)
                else:
                    return await finish_deployment(
                        pool, dep_id, job_id, False,
                        f"GitHub refused to merge PR #{dep['pr_number']}: {detail}",
                    )
            merge_sha = merge.json().get("sha")
        await pool.execute(
            "UPDATE dev_deployments SET merge_sha = $2, status = 'deploying' WHERE id = $1",
            dep_id, merge_sha,
        )
        if job_id is not None:
            await event(pool, job_id, "merged", f"Merged PR #{dep['pr_number']} ({(merge_sha or '')[:8]}).")

        checkout = CHECKOUT_PATH
        container_name = f"tillforty-deploy-{dep_id}"
        run(["docker", "rm", "-f", container_name], timeout=60)
        # NOT --rm: the exit code must survive for reconcile_deployments to read,
        # since ./start.sh restarts this very runner mid-deploy.
        started = run(
            [
                "docker", "run", "-d", "--name", container_name,
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
            return await finish_deployment(
                pool, dep_id, job_id, False,
                "Could not start the deploy container.",
                started.stdout + started.stderr,
            )
        container_id = started.stdout.strip()
        await pool.execute(
            "UPDATE dev_deployments SET container_id = $2 WHERE id = $1", dep_id, container_id
        )
        log(f"deployment {dep_id}: rebuild running in {container_name} ({container_id[:12]})")
        # From here on it's reconcile_deployments' job — this process may be
        # restarted by the very rebuild it just launched.
    except Exception:  # noqa: BLE001
        await finish_deployment(pool, dep_id, job_id, False,
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
            await finish_deployment(pool, dep["id"], dep["job_id"], False,
                                    "The deploy container disappeared before it reported a result.")
            continue
        state, _, code = inspect.stdout.strip().partition(" ")
        if state == "running":
            age = (datetime.now(timezone.utc) - dep["created_at"]).total_seconds()
            if age > DEPLOY_TIMEOUT:
                run(["docker", "rm", "-f", cid], timeout=60)
                await finish_deployment(pool, dep["id"], dep["job_id"], False,
                                        f"The deploy timed out after {DEPLOY_TIMEOUT}s.")
            continue
        logs = run(["docker", "logs", "--tail", "400", cid], timeout=60)
        ok = code.strip() == "0"
        await finish_deployment(
            pool, dep["id"], dep["job_id"], ok,
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
