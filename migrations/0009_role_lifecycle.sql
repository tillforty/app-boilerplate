-- 0009_role_lifecycle.sql
-- Role lifecycle: active / inactive. Deactivating a role is a soft state — it
-- keeps the role and all its data (description, permissions) and any users who
-- already have it, but marks it so the UI can dim it and stop offering it for
-- new assignments. System roles (administrator, member) stay active.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
