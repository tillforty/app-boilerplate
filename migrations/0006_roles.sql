-- 0006_roles.sql
-- Role-based access control. A user has one role (users.role_id). A role carries
-- a set of permission keys of the form 'resource:action' (e.g. 'users:read');
-- the wildcard '*' grants everything. The selectable catalog of permissions is
-- defined in code (backend/app/roles.py PERMISSION_CATALOG) so the UI can render
-- checkboxes — only the chosen keys are persisted here.
--
-- Two SYSTEM roles are seeded and must not be deletable (enforced in the API):
--   administrator — permissions ['*'] (can do anything; locked)
--   member        — a limited demo set (editable)

CREATE TABLE IF NOT EXISTS roles (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    permissions text[] NOT NULL DEFAULT '{}',
    is_system   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Each user points at one role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id bigint REFERENCES roles(id);

-- Seed the two system roles (idempotent). Administrator is always locked to ['*'].
INSERT INTO roles (name, description, permissions, is_system)
VALUES ('administrator', 'Full access to everything.', ARRAY['*'], true)
ON CONFLICT (name) DO UPDATE SET permissions = ARRAY['*'], is_system = true;

INSERT INTO roles (name, description, permissions, is_system)
VALUES ('member', 'Standard member with limited access.',
        ARRAY['users:read', 'files:read', 'files:upload'], true)
ON CONFLICT (name) DO UPDATE SET is_system = true;

-- Backfill any user without a role to administrator (covers the seeded user).
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'administrator')
WHERE role_id IS NULL;
