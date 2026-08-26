"""Tests for RBAC: the permission guard and the privilege-escalation cleaner."""
import pytest
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient

from app import auth, roles
from app.auth import UserOut
from conftest import make_app

USER = UserOut(id=7, name="Jane", surname="Doe", email="jane@example.com")


def permissions_returning(perms: set[str]):
    async def fake(user_id: int) -> set[str]:
        return perms

    return fake


@pytest.fixture
def guarded_client(monkeypatch):
    """A client for a one-route app guarded by require_permission('vault:read'),
    with authentication stubbed out. Set the caller's permissions via the
    returned setter."""
    app = make_app()

    @app.get("/guarded", dependencies=[Depends(roles.require_permission("vault:read"))])
    async def guarded() -> dict:
        return {"ok": True}

    app.dependency_overrides[auth.get_current_user] = lambda: USER

    def set_perms(perms: set[str]) -> None:
        monkeypatch.setattr(roles, "get_user_permissions", permissions_returning(perms))

    return TestClient(app), set_perms


class TestRequirePermission:
    def test_exact_permission_allows(self, guarded_client):
        client, set_perms = guarded_client
        set_perms({"vault:read"})
        assert client.get("/guarded").status_code == 200

    def test_wildcard_allows(self, guarded_client):
        client, set_perms = guarded_client
        set_perms({"*"})
        assert client.get("/guarded").status_code == 200

    def test_missing_permission_is_403(self, guarded_client):
        client, set_perms = guarded_client
        set_perms({"vault:write", "files:read"})
        res = client.get("/guarded")
        assert res.status_code == 403
        assert res.json()["detail"] == "Missing permission: vault:read"

    def test_empty_permission_set_is_403(self, guarded_client):
        client, set_perms = guarded_client
        set_perms(set())
        assert client.get("/guarded").status_code == 403


class TestCleanPermissions:
    """_clean_permissions is the privilege-escalation guard: nobody may grant a
    permission they do not themselves hold."""

    def test_unknown_permission_rejected(self):
        with pytest.raises(HTTPException) as exc:
            roles._clean_permissions(["users:read", "nonsense:zap"], {"*"})
        assert exc.value.status_code == 400
        assert "nonsense:zap" in exc.value.detail

    def test_wildcard_caller_may_grant_anything(self):
        got = roles._clean_permissions(["users:read", "*", "vault:write"], {"*"})
        assert got == ["users:read", "*", "vault:write"]

    def test_caller_cannot_grant_permission_they_lack(self):
        with pytest.raises(HTTPException) as exc:
            roles._clean_permissions(["vault:write"], {"roles:manage", "users:read"})
        assert exc.value.status_code == 403
        assert "vault:write" in exc.value.detail

    def test_caller_cannot_grant_wildcard_without_holding_it(self):
        # A holder of merely roles:manage must not mint a '*' role and escalate.
        with pytest.raises(HTTPException) as exc:
            roles._clean_permissions(["*"], {"roles:manage"})
        assert exc.value.status_code == 403

    def test_caller_may_grant_subset_of_own_permissions(self):
        got = roles._clean_permissions(
            ["users:read", "files:read"],
            {"roles:manage", "users:read", "files:read", "files:upload"},
        )
        assert got == ["users:read", "files:read"]

    def test_deduplicates_preserving_order(self):
        got = roles._clean_permissions(
            ["files:read", "users:read", "files:read"], {"*"}
        )
        assert got == ["files:read", "users:read"]

    def test_empty_list_is_allowed(self):
        assert roles._clean_permissions([], {"roles:manage"}) == []


class TestPermissionCatalog:
    def test_catalog_keys_match_all_permissions(self):
        # ALL_PERMISSIONS is derived from the catalog; a mismatch would let the
        # UI offer checkboxes the API then rejects (or vice versa).
        derived = {
            f"{group['resource']}:{action}"
            for group in roles.PERMISSION_CATALOG
            for action in group["actions"]
        }
        assert derived == roles.ALL_PERMISSIONS

    def test_wildcard_is_not_a_catalog_entry(self):
        assert roles.WILDCARD not in roles.ALL_PERMISSIONS
