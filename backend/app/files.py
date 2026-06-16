"""File storage: binaries on local disk, metadata in Postgres.

The `files` table holds only id, name, type, storage_path and created_at — the
binary itself lives on disk under STORAGE_DIR (a bind-mounted volume so it
persists). Deleting a row also removes the binary from disk (see delete_file).
Canonical DDL: migrations/0003_files.sql.
"""
import os
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import db
from .auth import UserOut, get_current_user

STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", "/srv/storage"))

router = APIRouter(prefix="/files", tags=["files"])


class FileType(str, Enum):
    """Kind of file. Extend per app (and ALTER TYPE file_type ADD VALUE ...)."""
    document = "document"
    image = "image"
    other = "other"


# Postgres has no CREATE TYPE IF NOT EXISTS, so the enum is created with a guard;
# the ALTER backfills `type` on tables created before this column.
CREATE_SCHEMA = """
DO $$ BEGIN
    CREATE TYPE file_type AS ENUM ('document', 'image', 'other');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS files (
    id           bigserial PRIMARY KEY,
    name         text NOT NULL,
    type         file_type NOT NULL DEFAULT 'other',
    storage_path text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE files ADD COLUMN IF NOT EXISTS type file_type NOT NULL DEFAULT 'other';
"""


async def ensure_schema() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    async with db.get_pool().acquire() as conn:
        await conn.execute(CREATE_SCHEMA)


def _resolve(storage_path: str) -> Path:
    """Resolve a stored (relative) path, refusing anything outside STORAGE_DIR."""
    base = STORAGE_DIR.resolve()
    full = (base / storage_path).resolve()
    if full != base and base not in full.parents:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid storage path")
    return full


class FileOut(BaseModel):
    id: int
    name: str
    type: FileType
    storage_path: str
    created_at: datetime


async def save_upload(name: str, data: bytes, file_type: FileType = FileType.other) -> dict:
    """Write a binary to local storage and record its metadata. Returns the row."""
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    # On-disk name is a random UUID (keeps the original extension); the human
    # name is preserved in the DB column.
    rel = f"{uuid.uuid4().hex}{Path(name).suffix}"
    dest = _resolve(rel)
    dest.write_bytes(data)
    try:
        row = await db.get_pool().fetchrow(
            "INSERT INTO files (name, type, storage_path) VALUES ($1, $2, $3) "
            "RETURNING id, name, type, storage_path, created_at",
            name,
            file_type.value,
            rel,
        )
    except Exception:
        # Don't leak an orphaned binary if the metadata insert fails.
        dest.unlink(missing_ok=True)
        raise
    return dict(row)


async def delete_file(file_id: int) -> bool:
    """Delete the DB row AND remove its binary. Returns False if no such row."""
    row = await db.get_pool().fetchrow(
        "DELETE FROM files WHERE id = $1 RETURNING storage_path", file_id
    )
    if row is None:
        return False
    _resolve(row["storage_path"]).unlink(missing_ok=True)
    return True


@router.post("", response_model=FileOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile,
    type: FileType = Form(FileType.other),
    _: UserOut = Depends(get_current_user),
) -> FileOut:
    data = await file.read()
    row = await save_upload(file.filename or "unnamed", data, type)
    return FileOut(**row)


@router.get("", response_model=list[FileOut])
async def list_files(_: UserOut = Depends(get_current_user)) -> list[FileOut]:
    rows = await db.get_pool().fetch(
        "SELECT id, name, type, storage_path, created_at FROM files ORDER BY id DESC"
    )
    return [FileOut(**dict(r)) for r in rows]


@router.get("/{file_id}/content")
async def download_file(file_id: int, _: UserOut = Depends(get_current_user)) -> FileResponse:
    row = await db.get_pool().fetchrow(
        "SELECT name, storage_path FROM files WHERE id = $1", file_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    path = _resolve(row["storage_path"])
    if not path.exists():
        raise HTTPException(status.HTTP_410_GONE, "Binary missing from storage")
    return FileResponse(path, filename=row["name"])


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file_endpoint(file_id: int, _: UserOut = Depends(get_current_user)) -> None:
    if not await delete_file(file_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
