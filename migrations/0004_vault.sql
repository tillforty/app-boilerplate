-- 0004_vault.sql
-- Encrypted secret store. Unlike user passwords (one-way bcrypt), these secrets
-- must be read back (3rd-party API tokens, etc.), so they are encrypted at rest
-- with pgcrypto's symmetric pgp_sym_encrypt using VAULT_KEY. Requires 0001.

-- migrate:up
CREATE TABLE IF NOT EXISTS vault_secrets (
    name       text PRIMARY KEY,
    value      bytea NOT NULL,           -- pgp_sym_encrypt(plaintext, VAULT_KEY)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
-- Destroys every stored secret: API keys, GitHub token, LLM credentials.
DROP TABLE IF EXISTS vault_secrets;
