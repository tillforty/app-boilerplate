"""Vector storage helpers backed by Postgres + pgvector.

Installs the pgvector extension so domain tables can carry their own embedding
columns and run nearest-neighbour search. There is no standalone embeddings
table — embeddings live on the tables that own the data they describe.
Canonical DDL: migrations/0005_pgvector.sql.
"""
import os

from fastapi import HTTPException, status

from . import db

EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "1536"))

CREATE_SCHEMA = "CREATE EXTENSION IF NOT EXISTS vector;"


async def ensure_schema() -> None:
    async with db.get_pool().acquire() as conn:
        await conn.execute(CREATE_SCHEMA)


def to_vector(embedding: list[float]) -> str:
    """Format a Python float list as a pgvector literal, e.g. '[0.1,0.2]'.

    Shared by any module that writes an embedding column. Validates the length
    against EMBEDDING_DIM so a mismatched vector fails before hitting Postgres.
    """
    if len(embedding) != EMBEDDING_DIM:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"embedding must have {EMBEDDING_DIM} dimensions, got {len(embedding)}",
        )
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"
