CREATE TABLE IF NOT EXISTS invites (
    id          bigserial PRIMARY KEY,
    email       text NOT NULL,
    token       text NOT NULL UNIQUE,
    role_id     bigint REFERENCES roles(id) ON DELETE SET NULL,
    invited_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    accepted_at timestamptz,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invites_token_idx ON invites (token);
