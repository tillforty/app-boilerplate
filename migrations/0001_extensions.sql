-- 0001_extensions.sql
-- Postgres extensions the boilerplate relies on.
-- pgcrypto powers the encrypted vault (pgp_sym_encrypt / pgp_sym_decrypt).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
