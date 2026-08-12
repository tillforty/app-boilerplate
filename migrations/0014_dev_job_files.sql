-- Prompt attachments for development-agent jobs: screenshots, logs, specs.
--
-- Why the bytes live here rather than in `files` (backend/app/files.py): the
-- agent_runner container talks to Postgres and nothing else — it has no
-- STORAGE_DIR mount and no Backblaze credentials — so the database is the only
-- channel that reaches the worker. Attachments are small and capped by
-- devagent.MAX_ATTACHMENTS / MAX_ATTACHMENT_BYTES.
--
-- The runner writes them into .agent/attachments/ inside its throw-away
-- workspace, which is excluded from git, so an attachment never lands in a
-- commit. Mirrored idempotently by devagent.ensure_schema().
CREATE TABLE IF NOT EXISTS dev_job_files (
    id         bigserial PRIMARY KEY,
    job_id     bigint NOT NULL REFERENCES dev_jobs(id) ON DELETE CASCADE,
    -- Sanitised basename, e.g. 'screenshot.png' — it becomes a real filename.
    name       text NOT NULL,
    mime       text,
    size       integer NOT NULL,
    data       bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_job_files_job_idx ON dev_job_files (job_id, id);
