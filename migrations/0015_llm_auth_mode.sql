-- Provider connections can authenticate two ways:
--   api_key       a provider API key, billed per token (the original behaviour)
--   subscription  an OAuth token from a Claude subscription, used by the
--                 headless Claude Code CLI (CLAUDE_CODE_OAUTH_TOKEN)
-- The secret itself still lives in the encrypted vault under
-- 'llm_credential:{id}' — only the mode is recorded here.
ALTER TABLE llm_credentials
    ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'api_key';

ALTER TABLE llm_credentials
    DROP CONSTRAINT IF EXISTS llm_credentials_auth_mode_check;

ALTER TABLE llm_credentials
    ADD CONSTRAINT llm_credentials_auth_mode_check
    CHECK (auth_mode IN ('api_key', 'subscription'));
