"""Tests for the auth router: login, the current-user dependency, password
change, and invite_url — all against FakePool, no real database."""
import datetime as dt

import jwt
import pytest
from fastapi.testclient import TestClient

from app import auth, security
from conftest import make_app


@pytest.fixture
def client(fake_pool) -> TestClient:
    return TestClient(make_app(auth.router))


def user_row(**overrides) -> dict:
    row = {
        "id": 7,
        "name": "Jane",
        "surname": "Doe",
        "email": "jane@example.com",
        "password_hash": None,
        "status": "active",
    }
    row.update(overrides)
    return row


def token_for(user_id: int = 7) -> str:
    return security.create_access_token(str(user_id))


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestGetCurrentUser:
    """Every malformed credential must map to 401 — never a 500."""

    def test_no_credentials_is_401(self, client):
        assert client.get("/auth/me").status_code == 401

    def test_garbage_token_is_401(self, client):
        assert client.get("/auth/me", headers=bearer("garbage")).status_code == 401

    def test_token_missing_sub_is_401(self, client):
        future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        token = jwt.encode(
            {"exp": int(future.timestamp())}, security.JWT_SECRET, algorithm=security.JWT_ALG
        )
        assert client.get("/auth/me", headers=bearer(token)).status_code == 401

    def test_token_with_non_numeric_sub_is_401(self, client):
        future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        token = jwt.encode(
            {"sub": "not-a-number", "exp": int(future.timestamp())},
            security.JWT_SECRET,
            algorithm=security.JWT_ALG,
        )
        assert client.get("/auth/me", headers=bearer(token)).status_code == 401

    def test_expired_token_is_401(self, client):
        past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
        token = jwt.encode(
            {"sub": "7", "exp": int(past.timestamp())},
            security.JWT_SECRET,
            algorithm=security.JWT_ALG,
        )
        assert client.get("/auth/me", headers=bearer(token)).status_code == 401

    def test_valid_token_unknown_user_is_401(self, client, fake_pool):
        fake_pool.queue("fetchrow", None)
        assert client.get("/auth/me", headers=bearer(token_for())).status_code == 401

    def test_deactivated_user_is_403(self, client, fake_pool):
        # Deactivation must invalidate already-issued tokens on their next use.
        fake_pool.queue("fetchrow", user_row(status="inactive"))
        assert client.get("/auth/me", headers=bearer(token_for())).status_code == 403

    def test_valid_token_active_user_succeeds(self, client, fake_pool):
        fake_pool.queue("fetchrow", user_row())
        res = client.get("/auth/me", headers=bearer(token_for()))
        assert res.status_code == 200
        assert res.json() == {
            "id": 7,
            "name": "Jane",
            "surname": "Doe",
            "email": "jane@example.com",
        }


class TestLogin:
    def test_successful_login_returns_working_token(self, client, fake_pool):
        fake_pool.queue(
            "fetchrow", user_row(password_hash=security.hash_password("secret123"))
        )
        res = client.post(
            "/auth/login", json={"email": "jane@example.com", "password": "secret123"}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "jane@example.com"
        assert security.decode_token(body["access_token"])["sub"] == "7"

    def test_wrong_password_is_401(self, client, fake_pool):
        fake_pool.queue(
            "fetchrow", user_row(password_hash=security.hash_password("secret123"))
        )
        res = client.post(
            "/auth/login", json={"email": "jane@example.com", "password": "wrong"}
        )
        assert res.status_code == 401

    def test_unknown_email_is_401(self, client, fake_pool):
        fake_pool.queue("fetchrow", None)
        res = client.post(
            "/auth/login", json={"email": "nobody@example.com", "password": "x"}
        )
        assert res.status_code == 401

    def test_pending_user_without_password_is_401(self, client, fake_pool):
        # Pending users have password_hash NULL — must hit the generic 401, not crash.
        fake_pool.queue("fetchrow", user_row(password_hash=None, status="pending"))
        res = client.post(
            "/auth/login", json={"email": "jane@example.com", "password": "anything"}
        )
        assert res.status_code == 401

    def test_deactivated_user_is_403_even_with_right_password(self, client, fake_pool):
        fake_pool.queue(
            "fetchrow",
            user_row(password_hash=security.hash_password("secret123"), status="inactive"),
        )
        res = client.post(
            "/auth/login", json={"email": "jane@example.com", "password": "secret123"}
        )
        assert res.status_code == 403

    def test_login_is_rate_limited_per_ip(self, client, fake_pool):
        for _ in range(5):
            fake_pool.queue("fetchrow", None)
        for _ in range(5):
            res = client.post("/auth/login", json={"email": "a@b.c", "password": "x"})
            assert res.status_code == 401
        res = client.post("/auth/login", json={"email": "a@b.c", "password": "x"})
        assert res.status_code == 429


class TestChangePassword:
    def test_wrong_current_password_is_400(self, client, fake_pool):
        fake_pool.queue("fetchrow", user_row())  # get_current_user lookup
        fake_pool.queue(
            "fetchrow", {"password_hash": security.hash_password("old-pass")}
        )
        res = client.post(
            "/auth/change-password",
            headers=bearer(token_for()),
            json={"current_password": "not-old-pass", "new_password": "new-pass-123"},
        )
        assert res.status_code == 400

    def test_correct_current_password_stores_new_hash(self, client, fake_pool):
        fake_pool.queue("fetchrow", user_row())
        fake_pool.queue(
            "fetchrow", {"password_hash": security.hash_password("old-pass")}
        )
        res = client.post(
            "/auth/change-password",
            headers=bearer(token_for()),
            json={"current_password": "old-pass", "new_password": "new-pass-123"},
        )
        assert res.status_code == 204
        method, query, args = fake_pool.calls[-1]
        assert method == "execute"
        assert "UPDATE users SET password_hash" in query
        assert security.verify_password("new-pass-123", args[1])


class TestInviteUrl:
    def test_uses_public_base_url_and_strips_trailing_slash(self, monkeypatch):
        monkeypatch.setenv("PUBLIC_BASE_URL", "https://app.example.com/")
        assert auth.invite_url("tok") == "https://app.example.com/invite/tok"

    def test_falls_back_to_domain(self, monkeypatch):
        monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
        monkeypatch.setenv("DOMAIN", "example.org")
        assert auth.invite_url("tok") == "https://example.org/invite/tok"

    def test_path_only_when_nothing_configured(self, monkeypatch):
        monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
        monkeypatch.delenv("DOMAIN", raising=False)
        assert auth.invite_url("tok") == "/invite/tok"
