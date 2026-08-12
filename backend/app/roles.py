"""Role-based access control: roles, permissions, and the permission guard.

A user has one role (users.role_id). A role carries a set of permission keys of
the form 'resource:action' (e.g. 'users:read'); the wildcard '*' grants
everything. Two system roles are seeded and cannot be deleted:
  - administrator: ['*']  (can do anything; permissions are locked)
  - member:        a limited demo set (editable)

PERMISSION_CATALOG is the list of selectable functions/actions — the UI renders
it as checkboxes; only the chosen keys are persisted. Canonical DDL:
migrations/0006_roles.sql.
"""
from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from . import db
from .auth import UserOut, get_current_user

router = APIRouter(prefix="/roles", tags=["roles"])

WILDCARD = "*"
ADMIN_ROLE = "administrator"
MEMBER_ROLE = "member"

# Catalog of selectable functions/actions, grouped by resource. Extend per app —
# add an entry here and it shows up as checkboxes in the role editor.
PERMISSION_CATALOG: list[dict] = [
    {"resource": "users", "label": "Users", "actions": ["read", "create", "update", "delete"]},
    {"resource": "roles", "label": "Roles", "actions": ["read", "manage"]},
    {"resource": "files", "label": "Files", "actions": ["read", "upload", "delete"]},
    {"resource": "vault", "label": "Vault", "actions": ["read", "write"]},
    {"resource": "customers", "label": "Customers", "actions": ["read", "create", "update", "delete"]},
    {"resource": "emails", "label": "Emails", "actions": ["read", "sync", "delete", "configure"]},
    {"resource": "ai", "label": "AI", "actions": ["use", "manage"]},
]

ALL_PERMISSIONS = {f"{g['resource']}:{a}" for g in PERMISSION_CATALOG for a in g["actions"]}

CREATE_SCHEMA = """
CREATE TABLE IF NOT EXISTS roles (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    permissions text[] NOT NULL DEFAULT '{}',
    is_system   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id bigint REFERENCES roles(id);
"""


async def ensure_schema_and_seed() -> None:
    """Create the roles table, seed the two system roles, link users.role_id.

    Must run AFTER auth.ensure_schema_and_seed (it ALTERs and backfills `users`).
    """
    async with db.get_pool().acquire() as conn:
        await conn.execute(CREATE_SCHEMA)
        # Lifecycle column (canonical DDL in migrations/0009_role_lifecycle.sql);
        # added here too so a fresh code deploy works even before migrations run.
        await conn.execute(
            "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true"
        )
        # Administrator is always locked to ['*'].
        await conn.execute(
            """
            INSERT INTO roles (name, description, permissions, is_system)
            VALUES ($1, 'Full access to everything.', ARRAY['*'], true)
            ON CONFLICT (name) DO UPDATE SET permissions = ARRAY['*'], is_system = true
            """,
            ADMIN_ROLE,
        )
        await conn.execute(
            """
            INSERT INTO roles (name, description, permissions, is_system)
            VALUES ($1, 'Standard member with limited access.', $2, true)
            ON CONFLICT (name) DO UPDATE SET is_system = true
            """,
            MEMBER_ROLE,
            ["users:read", "files:read", "files:upload", "customers:read"],
        )
        # Backfill any user without a role to administrator (covers the seed user).
        await conn.execute(
            "UPDATE users SET role_id = (SELECT id FROM roles WHERE name = $1) "
            "WHERE role_id IS NULL",
            ADMIN_ROLE,
        )


class Role(BaseModel):
    id: int
    name: str
    description: str
    permissions: list[str]
    is_system: bool
    is_active: bool
    created_at: datetime


class RoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class AssignRole(BaseModel):
    user_id: int
    role_id: int


async def get_user_permissions(user_id: int) -> set[str]:
    """Effective permission set for a user (empty if no role)."""
    perms = await db.get_pool().fetchval(
        "SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1",
        user_id,
    )
    return set(perms or [])


def require_permission(permission: str):
    """Dependency factory: 403 unless the current user has `permission` (or '*')."""

    async def dependency(user: UserOut = Depends(get_current_user)) -> UserOut:
        perms = await get_user_permissions(user.id)
        if WILDCARD in perms or permission in perms:
            return user
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"Missing permission: {permission}"
        )

    return dependency


def _clean_permissions(perms: list[str], caller_perms: set[str]) -> list[str]:
    """Reject unknown keys, de-duplicate while keeping order, and forbid granting
    any permission the caller does not itself hold (privilege-escalation guard).

    A caller with the wildcard '*' may grant anything; everyone else may only
    grant permissions contained in their own effective set — and '*' itself
    requires '*'. This stops a holder of merely 'roles:manage' from minting a
    role with '*' (or any permission they lack) and escalating through it.
    """
    unknown = [p for p in perms if p != WILDCARD and p not in ALL_PERMISSIONS]
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Unknown permissions: {sorted(set(unknown))}"
        )
    if WILDCARD not in caller_perms:
        escalating = sorted({p for p in perms if p not in caller_perms})
        if escalating:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"You cannot grant permissions you do not hold: {escalating}",
            )
    seen: set[str] = set()
    out: list[str] = []
    for p in perms:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


@router.get("/permissions")
async def permission_catalog(_: UserOut = Depends(get_current_user)) -> dict:
    """The catalog of selectable permissions, for rendering checkboxes."""
    return {"catalog": PERMISSION_CATALOG, "all": sorted(ALL_PERMISSIONS), "wildcard": WILDCARD}


@router.get("/me")
async def my_role(user: UserOut = Depends(get_current_user)) -> dict:
    """Current user's role name + effective permissions (for gating the UI)."""
    row = await db.get_pool().fetchrow(
        "SELECT r.name, r.permissions FROM users u JOIN roles r ON r.id = u.role_id "
        "WHERE u.id = $1",
        user.id,
    )
    if row is None:
        return {"role": None, "permissions": []}
    return {"role": row["name"], "permissions": list(row["permissions"])}


@router.get("", response_model=list[Role])
async def list_roles(_: UserOut = Depends(get_current_user)) -> list[Role]:
    rows = await db.get_pool().fetch(
        "SELECT id, name, description, permissions, is_system, is_active, created_at FROM roles ORDER BY id"
    )
    return [Role(**dict(r)) for r in rows]


@router.post("", response_model=Role, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreate, user: UserOut = Depends(require_permission("roles:manage"))
) -> Role:
    caller_perms = await get_user_permissions(user.id)
    perms = _clean_permissions(body.permissions, caller_perms)
    try:
        row = await db.get_pool().fetchrow(
            "INSERT INTO roles (name, description, permissions) VALUES ($1, $2, $3) "
            "RETURNING id, name, description, permissions, is_system, is_active, created_at",
            body.name,
            body.description,
            perms,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "A role with that name already exists")
    return Role(**dict(row))


@router.get("/{role_id}", response_model=Role)
async def get_role(role_id: int, _: UserOut = Depends(get_current_user)) -> Role:
    row = await db.get_pool().fetchrow(
        "SELECT id, name, description, permissions, is_system, is_active, created_at FROM roles WHERE id = $1",
        role_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    return Role(**dict(row))


@router.patch("/{role_id}", response_model=Role)
async def update_role(
    role_id: int,
    body: RoleUpdate,
    user: UserOut = Depends(require_permission("roles:manage")),
) -> Role:
    row = await db.get_pool().fetchrow("SELECT * FROM roles WHERE id = $1", role_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")

    # System roles can't be renamed; the administrator's permissions are locked.
    if row["is_system"] and body.name is not None and body.name != row["name"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "System roles cannot be renamed")
    if row["name"] == ADMIN_ROLE and body.permissions is not None and set(body.permissions) != {WILDCARD}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "The administrator role's permissions are locked"
        )

    fields: dict = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.description is not None:
        fields["description"] = body.description
    if body.permissions is not None:
        caller_perms = await get_user_permissions(user.id)
        fields["permissions"] = _clean_permissions(body.permissions, caller_perms)
    if not fields:
        return Role(**dict(row))

    sets = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(fields))
    try:
        updated = await db.get_pool().fetchrow(
            f"UPDATE roles SET {sets} WHERE id = $1 "
            "RETURNING id, name, description, permissions, is_system, is_active, created_at",
            role_id,
            *fields.values(),
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "A role with that name already exists")
    return Role(**dict(updated))


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int, _: UserOut = Depends(require_permission("roles:manage"))
) -> None:
    row = await db.get_pool().fetchrow(
        "SELECT name, is_system FROM roles WHERE id = $1", role_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if row["is_system"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "System roles cannot be deleted")
    in_use = await db.get_pool().fetchval(
        "SELECT count(*) FROM users WHERE role_id = $1", role_id
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Role is assigned to {in_use} user(s); reassign them first"
        )
    await db.get_pool().execute("DELETE FROM roles WHERE id = $1", role_id)


async def _set_active(role_id: int, active: bool) -> Role:
    """Flip a role's active flag. Soft — keeps the role and all its data."""
    row = await db.get_pool().fetchrow(
        "SELECT name, is_system FROM roles WHERE id = $1", role_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    # System roles (administrator, member) must stay available.
    if row["is_system"] and not active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "System roles cannot be deactivated")
    updated = await db.get_pool().fetchrow(
        "UPDATE roles SET is_active = $2 WHERE id = $1 "
        "RETURNING id, name, description, permissions, is_system, is_active, created_at",
        role_id,
        active,
    )
    return Role(**dict(updated))


@router.post("/{role_id}/deactivate", response_model=Role)
async def deactivate_role(
    role_id: int, _: UserOut = Depends(require_permission("roles:manage"))
) -> Role:
    return await _set_active(role_id, False)


@router.post("/{role_id}/activate", response_model=Role)
async def activate_role(
    role_id: int, _: UserOut = Depends(require_permission("roles:manage"))
) -> Role:
    return await _set_active(role_id, True)


@router.put("/assign", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role(
    body: AssignRole, user: UserOut = Depends(require_permission("roles:manage"))
) -> None:
    role_perms = await db.get_pool().fetchval(
        "SELECT permissions FROM roles WHERE id = $1", body.role_id
    )
    if role_perms is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    # Privilege-escalation guard: assigning a role grants its permissions, so a
    # caller may only assign a role whose permissions are a subset of their own
    # effective set (a caller with '*' may assign anything). Otherwise a holder
    # of merely 'roles:manage' could assign the administrator role and escalate.
    caller_perms = await get_user_permissions(user.id)
    if WILDCARD not in caller_perms:
        excess = sorted({p for p in role_perms if p not in caller_perms})
        if excess:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"You cannot assign a role granting permissions you do not hold: {excess}",
            )
    updated = await db.get_pool().fetchval(
        "UPDATE users SET role_id = $2 WHERE id = $1 RETURNING id",
        body.user_id,
        body.role_id,
    )
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
