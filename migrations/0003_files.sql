-- 0003_files.sql
-- File storage metadata. The binary itself lives on disk under STORAGE_DIR
-- (a persistent bind-mounted volume); only metadata is kept in Postgres.
-- `storage_path` is a random UUID filename relative to STORAGE_DIR.
--
-- Postgres has no CREATE TYPE IF NOT EXISTS, so the enum is created inside a
-- guarded DO block. Extend the enum per app with: ALTER TYPE file_type ADD VALUE '...'.

DO $$ BEGIN
    CREATE TYPE file_type AS ENUM ('document', 'image', 'other');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS files (
    id           bigserial PRIMARY KEY,
    name         text NOT NULL,
    type         file_type NOT NULL DEFAULT 'other',
    storage_path text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Backfill `type` on tables created before this column existed.
ALTER TABLE files ADD COLUMN IF NOT EXISTS type file_type NOT NULL DEFAULT 'other';
