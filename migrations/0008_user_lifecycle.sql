-- 0008_user_lifecycle.sql
-- User lifecycle: active / pending (invited, not yet accepted) / inactive
-- (deactivated/archived — kept for audit, cannot log in). Pending users are
-- created by invitation and have no password until they accept via the public
-- /invite/<token> page, so password_hash becomes nullable.

-- migrate:up
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_constraint WHERE conname = 'users_status_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_status_check
            CHECK (status IN ('active', 'pending', 'inactive'));
    END IF;
END $$;

-- migrate:down
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users DROP COLUMN IF EXISTS invited_at;
ALTER TABLE users DROP COLUMN IF EXISTS invite_token;
ALTER TABLE users DROP COLUMN IF EXISTS status;

-- Restoring NOT NULL is only possible once no passwordless user is left. An
-- invited user who never accepted has no password by definition, so fail loudly
-- with the fix rather than silently leaving the column nullable (which would
-- make this migration's state a lie) or deleting real rows to force it through.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE password_hash IS NULL) THEN
        RAISE EXCEPTION
            'Cannot restore users.password_hash NOT NULL: % passwordless (invited) user(s) remain. Delete or complete them first.',
            (SELECT count(*) FROM users WHERE password_hash IS NULL);
    END IF;
    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
END $$;
