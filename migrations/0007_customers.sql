-- Customers: an example real domain table (the CRM demo page is wired to this).
-- Depends on 0005_pgvector.sql for the optional `embedding` column used by the
-- semantic search endpoint.
--
-- NOTE: the 1536 below is the default EMBEDDING_DIM (text-embedding-3-small).
-- customers.ensure_schema() creates this same table parameterised by the
-- EMBEDDING_DIM env var, so an install that overrides it relies on that path,
-- not on this file. Change both together.

-- migrate:up
CREATE TABLE IF NOT EXISTS customers (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL,
    company    text NOT NULL DEFAULT '',
    email      text NOT NULL,
    status     text NOT NULL DEFAULT 'lead'
               CHECK (status IN ('active', 'trial', 'churned', 'lead')),
    mrr        integer NOT NULL DEFAULT 0,   -- monthly recurring revenue, USD
    seats      integer NOT NULL DEFAULT 0,
    embedding  vector(1536),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Approximate nearest-neighbour index for /customers/search (cosine distance).
-- Safe with NULL embeddings; only rows that have one are indexed.
CREATE INDEX IF NOT EXISTS customers_embedding_idx
    ON customers USING hnsw (embedding vector_cosine_ops);

-- migrate:down
DROP TABLE IF EXISTS customers;
