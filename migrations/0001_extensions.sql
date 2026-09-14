-- 0001_extensions.sql
-- Postgres extensions the boilerplate relies on.
-- pgcrypto powers the encrypted vault (pgp_sym_encrypt / pgp_sym_decrypt).

-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- migrate:down
-- Dropping this breaks vault_secrets decryption; 0004's down must run first.
DROP EXTENSION IF EXISTS pgcrypto;
