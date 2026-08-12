-- 0008_user_lifecycle.sql
-- User lifecycle: active / pending (invited, not yet accepted) / inactive
-- (deactivated/archived — kept for audit, cannot log in). Pending users are
-- created by invitation and have no password until they accept via the public
-- /invite/<token> page, so password_hash becomes nullable.

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
