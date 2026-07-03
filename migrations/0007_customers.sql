-- Customers: an example real domain table (the CRM demo page is wired to this).
-- Depends on 0005_pgvector.sql for the optional `embedding` column used by the
-- semantic search endpoint. The backend also self-seeds this schema on startup
-- (customers.ensure_schema), so this file is the canonical DDL.

CREATE TABLE IF NOT EXISTS customers (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL,
    company    text NOT NULL DEFAULT '',
    email      text NOT NULL,
    status     text NOT NULL DEFAULT 'lead'
               CHECK (status IN ('active', 'trial', 'churned', 'lead')),
    mrr        integer NOT NULL DEFAULT 0,   -- monthly recurring revenue, USD
    seats      integer NOT NULL DEFAULT 0,
    -- Optional embedding for semantic search. Dimension matches the default
    -- EMBEDDING_DIM (text-embedding-3-small = 1536). Change both together.
    embedding  vector(1536),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Approximate nearest-neighbour index for /customers/search (cosine distance).
-- Safe with NULL embeddings; only rows that have one are indexed.
CREATE INDEX IF NOT EXISTS customers_embedding_idx
    ON customers USING hnsw (embedding vector_cosine_ops);
