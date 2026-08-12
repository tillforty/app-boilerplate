-- What each development-agent job cost to complete.
--
-- The coding CLI reports cost and tokens per run (`claude --output-format json`),
-- but a job is rarely one run: every answer round, every retry, and every
-- conflict resolution starts another. These columns are therefore accumulators —
-- the runner adds to them, never assigns.
--
-- merge_cost_usd is the slice of cost_usd spent resolving merge conflicts. It is
-- deliberately a subset rather than a separate bill: the work belongs to the job,
-- but keeping it visible is how "this branch went stale" stops being invisible.
--
-- First migration on the timestamp convention (YYYYMMDDHHMM_) — see README. It
-- sorts after the historical 0001-0014 files, and can't collide with a number a
-- fork happens to pick next.

ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS cost_usd          numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS merge_cost_usd    numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS input_tokens      bigint        NOT NULL DEFAULT 0;
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS output_tokens     bigint        NOT NULL DEFAULT 0;
ALTER TABLE dev_jobs ADD COLUMN IF NOT EXISTS cache_read_tokens bigint        NOT NULL DEFAULT 0;
