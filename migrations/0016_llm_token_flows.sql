-- Browser sign-in flows for Claude subscription tokens.
--
-- The API container has no Node runtime and no `claude` CLI (deliberately — see
-- agent-runner/Dockerfile), so it can't mint a subscription token itself. This
-- table is the hand-off: the API inserts a row, the agent runner picks it up and
-- drives `claude setup-token` in a pty, writes back the authorize URL, and — once
-- the user pastes the browser code — stores the minted token in the vault under
-- 'llm_token_flow:{id}'. The token itself is never a column here.
CREATE TABLE IF NOT EXISTS llm_token_flows (
    id         bigserial PRIMARY KEY,
    state      text NOT NULL DEFAULT 'requested'
               CHECK (state IN ('requested', 'awaiting_code', 'code_submitted', 'done', 'failed')),
    url        text,   -- the authorize URL scraped from the CLI
    code       text,   -- the code the user pasted back from the browser
    error      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_token_flows_state_idx ON llm_token_flows (state, created_at);
