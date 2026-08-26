"""Tests for file storage: the LocalStorage path-traversal guard, the local
read/write/delete roundtrip, and save_upload's orphan-cleanup contract."""
import pytest
from fastapi import HTTPException

from app import files
from app.files import FileType, LocalStorage


class TestLocalStoragePathGuard:
    """_resolve must never yield a path outside the storage base directory."""

    @pytest.mark.parametrize(
        "key",
        [
            "../escape.bin",
            "../../etc/passwd",
            "a/../../outside.bin",
            "/etc/passwd",
            "..",
        ],
    )
    def test_traversal_keys_rejected(self, tmp_path, key):
        storage = LocalStorage(tmp_path)
        with pytest.raises(HTTPException) as exc:
            storage._resolve(key)
        assert exc.value.status_code == 400

    def test_plain_key_resolves_inside_base(self, tmp_path):
        storage = LocalStorage(tmp_path)
        resolved = storage._resolve("abc123.bin")
        assert resolved == tmp_path.resolve() / "abc123.bin"

    def test_dot_segments_that_stay_inside_are_allowed(self, tmp_path):
        storage = LocalStorage(tmp_path)
        assert storage._resolve("a/../b.bin") == tmp_path.resolve() / "b.bin"


class TestLocalStorageRoundtrip:
    async def test_write_read_delete(self, tmp_path):
        storage = LocalStorage(tmp_path)
        await storage.write("key.bin", b"payload")
        assert await storage.read("key.bin") == b"payload"
        await storage.delete("key.bin")
        assert not (tmp_path / "key.bin").exists()

    async def test_read_missing_key_is_410(self, tmp_path):
        storage = LocalStorage(tmp_path)
        with pytest.raises(HTTPException) as exc:
            await storage.read("never-written.bin")
        assert exc.value.status_code == 410

    async def test_delete_missing_key_is_a_noop(self, tmp_path):
        await LocalStorage(tmp_path).delete("never-written.bin")

    async def test_write_creates_base_directory(self, tmp_path):
        storage = LocalStorage(tmp_path / "not-yet-created")
        await storage.write("key.bin", b"x")
        assert await storage.read("key.bin") == b"x"


class FakeBackend:
    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    async def write(self, key: str, data: bytes) -> None:
        self.store[key] = data

    async def read(self, key: str) -> bytes:
        return self.store[key]

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)


@pytest.fixture
def fake_backend(monkeypatch) -> FakeBackend:
    backend = FakeBackend()
    monkeypatch.setattr(files, "get_backend", lambda: backend)
    return backend


class TestSaveUpload:
    async def test_writes_binary_and_records_metadata(self, fake_pool, fake_backend):
        fake_pool.queue(
            "fetchrow",
            {
                "id": 1,
                "name": "report.pdf",
                "type": "document",
                "storage_path": "ignored-by-test",
                "created_at": "2026-01-01T00:00:00Z",
            },
        )
        row = await files.save_upload("report.pdf", b"pdf-bytes", FileType.document)
        assert row["name"] == "report.pdf"
        # The stored key is a uuid + the original extension, never the raw name
        # (which could contain traversal characters).
        (key,) = fake_backend.store
        assert key.endswith(".pdf")
        assert "report" not in key
        assert fake_backend.store[key] == b"pdf-bytes"

    async def test_failed_metadata_insert_removes_orphaned_binary(
        self, fake_pool, fake_backend
    ):
        fake_pool.queue("fetchrow", RuntimeError("insert failed"))
        with pytest.raises(RuntimeError):
            await files.save_upload("report.pdf", b"pdf-bytes")
        assert fake_backend.store == {}


class TestDeleteFile:
    async def test_deletes_row_and_binary(self, fake_pool, fake_backend):
        fake_backend.store["stored-key.bin"] = b"data"
        fake_pool.queue("fetchrow", {"storage_path": "stored-key.bin"})
        assert await files.delete_file(1) is True
        assert fake_backend.store == {}

    async def test_missing_row_returns_false(self, fake_pool, fake_backend):
        fake_pool.queue("fetchrow", None)
        assert await files.delete_file(999) is False
