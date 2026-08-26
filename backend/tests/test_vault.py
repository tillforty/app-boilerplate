"""Tests for the vault router: permission gating and the endpoint contract.

pgp_sym_encrypt/decrypt live in Postgres, so set_secret/get_secret are replaced
with an in-memory store; what's under test is the HTTP surface — auth, the
permission guards, 204/404 semantics — not pgcrypto itself.
"""
import pytest
from fastapi.testclient import TestClient

from app import auth, roles, vault
from app.auth import UserOut
from conftest import make_app

USER = UserOut(id=7, name="Jane", surname="Doe", email="jane@example.com")


@pytest.fixture
def secrets_store(monkeypatch) -> dict:
    store: dict[str, str] = {}

    async def fake_set(name: str, value: str) -> None:
        store[name] = value

    async def fake_get(name: str) -> str | None:
        return store.get(name)

    monkeypatch.setattr(vault, "set_secret", fake_set)
    monkeypatch.setattr(vault, "get_secret", fake_get)
    return store


def make_client(monkeypatch, perms: set[str] | None) -> TestClient:
    """Client for the vault router; perms=None leaves auth unstubbed."""
    app = make_app(vault.router)
    if perms is not None:
        app.dependency_overrides[auth.get_current_user] = lambda: USER

        async def fake_perms(user_id: int) -> set[str]:
            return perms

        monkeypatch.setattr(roles, "get_user_permissions", fake_perms)
    return TestClient(app)


class TestVaultEndpoints:
    def test_put_then_get_roundtrip(self, monkeypatch, secrets_store):
        client = make_client(monkeypatch, {"vault:read", "vault:write"})
        res = client.put("/vault", json={"name": "api-token", "value": "s3cret"})
        assert res.status_code == 204
        assert secrets_store == {"api-token": "s3cret"}

        res = client.get("/vault/api-token")
        assert res.status_code == 200
        assert res.json() == {"name": "api-token", "value": "s3cret"}

    def test_put_overwrites_existing_secret(self, monkeypatch, secrets_store):
        client = make_client(monkeypatch, {"vault:write"})
        client.put("/vault", json={"name": "api-token", "value": "old"})
        client.put("/vault", json={"name": "api-token", "value": "new"})
        assert secrets_store == {"api-token": "new"}

    def test_get_missing_secret_is_404(self, monkeypatch, secrets_store):
        client = make_client(monkeypatch, {"vault:read"})
        assert client.get("/vault/nope").status_code == 404

    def test_write_permission_does_not_grant_read(self, monkeypatch, secrets_store):
        client = make_client(monkeypatch, {"vault:write"})
        assert client.get("/vault/api-token").status_code == 403

    def test_read_permission_does_not_grant_write(self, monkeypatch, secrets_store):
        client = make_client(monkeypatch, {"vault:read"})
        res = client.put("/vault", json={"name": "n", "value": "v"})
        assert res.status_code == 403
        assert secrets_store == {}

    def test_unauthenticated_requests_are_401(self, monkeypatch, secrets_store):
        client = make_client(monkeypatch, perms=None)
        assert client.get("/vault/api-token").status_code == 401
        assert client.put("/vault", json={"name": "n", "value": "v"}).status_code == 401
