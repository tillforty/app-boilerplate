-- Split "merged" from "deployed".
--
-- Before: every Deploy merged one PR and rebuilt the server, so shipping four
-- jobs meant four full rebuilds — and each merge stranded the other branches,
-- because they had all been cut from the same commit.
--
-- After: a finished job merges into the base branch immediately (conflicts
-- resolved by the agent) and waits in `merged`. Merged work accumulates, and one
-- manual release rebuilds the server once for all of it.
--
--   pending → running → [answer_pending ⇄ running] → merged
--           → deploying → deployed        (or deployment_ready / failed / cancelled)
--
-- `deployment_ready` now means "PR is open but the auto-merge did not succeed",
-- i.e. it needs a human, rather than "ready to ship".
--
-- A row in dev_deployments is now a RELEASE covering many jobs, not one PR.
-- Mirrored idempotently by devagent.ensure_schema().

-- Jobs remember which release shipped them.
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS release_id bigint
    REFERENCES dev_deployments(id) ON DELETE SET NULL;
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS merged_at timestamptz;

CREATE INDEX IF NOT EXISTS dev_jobs_release_idx ON dev_jobs (release_id);

-- Widen the status vocabulary with 'merged'.
ALTER TABLE dev_jobs DROP CONSTRAINT IF EXISTS dev_jobs_status_check;
ALTER TABLE dev_jobs ADD CONSTRAINT dev_jobs_status_check CHECK (
    status IN ('pending', 'running', 'answer_pending', 'merged',
               'deployment_ready', 'deploying', 'deployed', 'failed', 'cancelled')
);

-- A release covers N jobs, so per-PR columns become optional and a release gets
-- its own number. Existing per-PR rows keep their data and read as one-job
-- releases, which is exactly what they were.
ALTER TABLE dev_deployments ADD COLUMN IF NOT EXISTS release_number integer;
ALTER TABLE dev_deployments ADD COLUMN IF NOT EXISTS job_count integer NOT NULL DEFAULT 0;

-- Backfill: number the historical deployments in the order they happened, and
-- attribute each one's job to it so the history stays complete.
WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM dev_deployments
)
UPDATE dev_deployments d SET release_number = n
FROM numbered WHERE numbered.id = d.id AND d.release_number IS NULL;

UPDATE dev_jobs j SET release_id = d.id
FROM dev_deployments d
WHERE d.job_id = j.id AND j.release_id IS NULL AND j.status = 'deployed';

UPDATE dev_deployments d SET job_count = COALESCE(
    (SELECT count(*) FROM dev_jobs j WHERE j.release_id = d.id), 0);

-- Anything that had an open PR ready to ship becomes 'deployment_ready' still,
-- but a job whose PR is already merged should wait in the release queue.
UPDATE dev_jobs SET merged_at = finished_at
WHERE status = 'deployed' AND merged_at IS NULL;

-- A failed auto-merge leaves the PR open and needs a human nudge; this is the
-- flag the "Retry merge" action sets for the runner to pick up.
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS merge_requested boolean NOT NULL DEFAULT false;
