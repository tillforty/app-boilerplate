-- 0002_users.sql
-- Application users. Passwords are stored as one-way bcrypt hashes (never the
-- plaintext, never reversible). Login issues a JWT (see backend/app/security.py).
-- The first user is seeded from SEED_USER_* env vars on API startup.

CREATE TABLE IF NOT EXISTS users (
    id            bigserial PRIMARY KEY,
    name          text NOT NULL,
    surname       text NOT NULL,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
