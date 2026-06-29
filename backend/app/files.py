"""File storage: local disk or Backblaze B2, metadata in Postgres.

STORAGE_TYPE=local (default) — binaries saved under STORAGE_DIR on disk.
STORAGE_TYPE=backblaze       — binaries stored in Backblaze B2 via S3-compatible API.

Required env vars when STORAGE_TYPE=backblaze:
  B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT_URL
"""
import io
import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import db
from .auth import UserOut, get_current_user

STORAGE_TYPE = os.environ.get("STORAGE_TYPE", "local").lower()
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", "/srv/storage"))

router = APIRouter(prefix="/files", tags=["files"])


class FileType(str, Enum):
    """Kind of file. Extend per app (and ALTER TYPE file_type ADD VALUE ...)."""
    document = "document"
    image = "image"
    other = "other"


# Postgres has no CREATE TYPE IF NOT EXISTS, so the enum is created with a guard.
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


# ── Storage backends ──────────────────────────────────────────────────────────

class StorageBackend(ABC):
    @abstractmethod
    async def write(self, key: str, data: bytes) -> None: ...
    @abstractmethod
    async def read(self, key: str) -> bytes: ...
    @abstractmethod
    async def delete(self, key: str) -> None: ...


class LocalStorage(StorageBackend):
    def __init__(self, base: Path) -> None:
        self._base = base

    def _resolve(self, key: str) -> Path:
        base = self._base.resolve()
        full = (base / key).resolve()
        if full != base and base not in full.parents:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid storage path")
        return full

    async def write(self, key: str, data: bytes) -> None:
        self._base.mkdir(parents=True, exist_ok=True)
        self._resolve(key).write_bytes(data)

    async def read(self, key: str) -> bytes:
        path = self._resolve(key)
        if not path.exists():
            raise HTTPException(status.HTTP_410_GONE, "Binary missing from storage")
        return path.read_bytes()

    async def delete(self, key: str) -> None:
        self._resolve(key).unlink(missing_ok=True)


class BackblazeStorage(StorageBackend):
    def __init__(self) -> None:
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise RuntimeError(
                "boto3 is required for Backblaze storage — add it to requirements.txt"
            ) from exc

        self._bucket = os.environ["B2_BUCKET_NAME"]
        self._client = boto3.client(
            "s3",
            endpoint_url=os.environ["B2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["B2_KEY_ID"],
            aws_secret_access_key=os.environ["B2_APPLICATION_KEY"],
            config=Config(signature_version="s3v4"),
        )

    async def write(self, key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data)

    async def read(self, key: str) -> bytes:
        try:
            resp = self._client.get_object(Bucket=self._bucket, Key=key)
            return resp["Body"].read()
        except Exception:
            raise HTTPException(status.HTTP_410_GONE, "Binary missing from storage")

    async def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


_backend: StorageBackend | None = None


def get_backend() -> StorageBackend:
    global _backend
    if _backend is None:
        _backend = BackblazeStorage() if STORAGE_TYPE == "backblaze" else LocalStorage(STORAGE_DIR)
    return _backend


# ── Schema + helpers ──────────────────────────────────────────────────────────

class FileOut(BaseModel):
    id: int
    name: str
    type: FileType
    storage_path: str
    created_at: datetime


async def ensure_schema() -> None:
    if STORAGE_TYPE == "local":
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    async with db.get_pool().acquire() as conn:
        await conn.execute(CREATE_SCHEMA)


async def save_upload(name: str, data: bytes, file_type: FileType = FileType.other) -> dict:
    """Write binary to the active storage backend and record metadata. Returns the row."""
    key = f"{uuid.uuid4().hex}{Path(name).suffix}"
    backend = get_backend()
    await backend.write(key, data)
    try:
        row = await db.get_pool().fetchrow(
            "INSERT INTO files (name, type, storage_path) VALUES ($1, $2, $3) "
            "RETURNING id, name, type, storage_path, created_at",
            name,
            file_type.value,
            key,
        )
    except Exception:
        # Don't leak an orphaned binary if the metadata insert fails.
        await backend.delete(key)
        raise
    return dict(row)


async def delete_file(file_id: int) -> bool:
    """Delete the DB row and the stored binary. Returns False if no such row."""
    row = await db.get_pool().fetchrow(
        "DELETE FROM files WHERE id = $1 RETURNING storage_path", file_id
    )
    if row is None:
        return False
    await get_backend().delete(row["storage_path"])
    return True


# ── API endpoints ─────────────────────────────────────────────────────────────

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
async def download_file(file_id: int, _: UserOut = Depends(get_current_user)):
    row = await db.get_pool().fetchrow(
        "SELECT name, storage_path FROM files WHERE id = $1", file_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    backend = get_backend()
    if isinstance(backend, LocalStorage):
        path = backend._resolve(row["storage_path"])
        if not path.exists():
            raise HTTPException(status.HTTP_410_GONE, "Binary missing from storage")
        return FileResponse(path, filename=row["name"])
    # Remote backend: stream bytes through the API
    data = await backend.read(row["storage_path"])
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{row["name"]}"'},
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file_endpoint(file_id: int, _: UserOut = Depends(get_current_user)) -> None:
    if not await delete_file(file_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
