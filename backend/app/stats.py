"""Aggregate counts that power the dashboard "Overview" cards.

Real figures pulled straight from Postgres — replace/extend the query with your
own domain metrics as the app grows.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import db
from .auth import UserOut
from .roles import require_permission

router = APIRouter(prefix="/stats", tags=["stats"])


class Stats(BaseModel):
    users: int
    roles: int
    customers: int
    active_customers: int
    mrr: int  # summed monthly recurring revenue of active customers, EUR
    files: int


@router.get("", response_model=Stats)
async def get_stats(_: UserOut = Depends(require_permission("customers:read"))) -> Stats:
    row = await db.get_pool().fetchrow(
        """
        SELECT
            (SELECT count(*) FROM users)                                    AS users,
            (SELECT count(*) FROM roles)                                    AS roles,
            (SELECT count(*) FROM customers)                                AS customers,
            (SELECT count(*) FROM customers WHERE status = 'active')        AS active_customers,
            (SELECT COALESCE(sum(mrr), 0) FROM customers WHERE status = 'active') AS mrr,
            (SELECT count(*) FROM files)                                    AS files
        """
    )
    return Stats(**dict(row))
