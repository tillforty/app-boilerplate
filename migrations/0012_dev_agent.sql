-- Development agent: automated coding jobs, their PRs, and deployment history.
--
-- Flow (see backend/app/devagent.py + agent-runner/runner.py):
--   pending → running → [answer_pending ⇄ running] → deployment_ready
--           → deploying → deployed        (or failed / cancelled at any point)
--
-- Secrets (the GitHub token) live in vault_secrets under 'dev_agent:github_token',
-- never in these tables. Mirrored idempotently by devagent.ensure_schema().

-- ── Repo configuration (singleton, like app_settings) ───────────────────────
CREATE TABLE IF NOT EXISTS dev_settings (
    id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    -- "owner/name" on github.com, e.g. 'tillforty/app-boilerplate'.
    repo_full_name text,
    base_branch    text NOT NULL DEFAULT 'main',
    -- Server checkout that the Deploy button pulls + rebuilds.
    checkout_path  text NOT NULL DEFAULT '/opt/app-boilerplate',
    -- Master switch for the Deploy button (merging a PR rebuilds this server).
    deploy_enabled boolean NOT NULL DEFAULT false,
    has_token      boolean NOT NULL DEFAULT false,
    -- Result of the last "Validate access" run: {checks: [...], ok: bool}.
    validation     jsonb,
    validated_at   timestamptz,
    -- Heartbeat written by agent-runner every poll, so the API (which has no
    -- git/CLI/docker of its own) can report whether the worker is alive and
    -- what it found on the host: {checkout_remote, has_docker, cli: {...}}.
    runner_seen_at timestamptz,
    runner_info    jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO dev_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Jobs ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dev_jobs (
    id           bigserial PRIMARY KEY,
    title        text NOT NULL,
    prompt       text NOT NULL,
    -- Which CLI ran it: resolved from the 'development_agent' binding in
    -- Settings › App › AI functions (anthropic → claude_code, openai → codex).
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
    -- Set when the agent needs clarification; cleared when the answer is sent.
    question     text,
    error        text,
    -- Tail of the agent's stdout/stderr, for the job detail drawer.
    log          text,
    -- Bumped every time the job is queued, so a stuck run can be retried.
    attempts     integer NOT NULL DEFAULT 0,
    created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_jobs_status_idx  ON dev_jobs (status);
CREATE INDEX IF NOT EXISTS dev_jobs_created_idx ON dev_jobs (created_at DESC);

-- ── Job timeline (one row per state change / agent message) ─────────────────
CREATE TABLE IF NOT EXISTS dev_job_events (
    id         bigserial PRIMARY KEY,
    job_id     bigint NOT NULL REFERENCES dev_jobs(id) ON DELETE CASCADE,
    kind       text NOT NULL,
    message    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_job_events_job_idx ON dev_job_events (job_id, created_at);

-- ── Deployment history (every version that went live) ──────────────────────
CREATE TABLE IF NOT EXISTS dev_deployments (
    id            bigserial PRIMARY KEY,
    job_id        bigint REFERENCES dev_jobs(id) ON DELETE SET NULL,
    pr_number     integer,
    pr_url        text,
    merge_sha     text,
    -- Human label shown in the history table, e.g. 'PR #42'.
    version_label text,
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'merging', 'deploying', 'deployed', 'failed')),
    -- Sibling container running the host rebuild; lets the runner reconcile
    -- after it is itself restarted by that same rebuild.
    container_id  text,
    error         text,
    log           text,
    deployed_by   bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS dev_deployments_created_idx ON dev_deployments (created_at DESC);
