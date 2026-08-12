-- 0011_llm.sql — Runtime LLM provider credentials + per-function model bindings.
--
-- API keys are NEVER stored in this table. They live encrypted in
-- vault_secrets (pgcrypto pgp_sym_encrypt, see 0004_vault.sql) under the name
-- 'llm_credential:'||id. `has_key` mirrors whether that secret exists, so the
-- UI can show configured/unconfigured without decrypting anything.
--
-- Idempotent mirror lives in backend/app/llmconfig.py ensure_schema().

CREATE TABLE IF NOT EXISTS llm_credentials (
    id            bigserial PRIMARY KEY,
    provider      text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
    label         text NOT NULL,
    base_url      text,
    default_model text,
    has_key       boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per app AI function (registry in llmconfig.AI_FUNCTIONS). Points a
-- function at a saved credential + a chosen model. ON DELETE SET NULL so
-- deleting a credential cleanly unbinds any functions that used it.
CREATE TABLE IF NOT EXISTS ai_function_bindings (
    function_key  text PRIMARY KEY,
    credential_id bigint REFERENCES llm_credentials(id) ON DELETE SET NULL,
    model         text,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
