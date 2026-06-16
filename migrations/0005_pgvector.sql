-- 0005_pgvector.sql
-- pgvector enables embedding columns + nearest-neighbour search. Embeddings live
-- on the domain tables that own the data they describe (there is no standalone
-- embeddings table); each such column's width must equal EMBEDDING_DIM.
--
-- Example domain usage:
--   ALTER TABLE my_table ADD COLUMN embedding vector(1536);
--   CREATE INDEX ON my_table USING hnsw (embedding vector_cosine_ops);

CREATE EXTENSION IF NOT EXISTS vector;
