"""Shared test setup.

The app modules read JWT_SECRET / VAULT_KEY at import time and refuse to start
without them, so the test values must be in the environment before anything
under `app` is imported. conftest is imported before any test module, which
makes this the one reliable place to set them.

No real Postgres is used: tests monkeypatch `db.get_pool` with FakePool, which
queues canned results per method and records every call.
"""
import os

os.environ["JWT_SECRET"] = "test-jwt-secret"
os.environ["VAULT_KEY"] = "test-vault-key"

import pytest
from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app import db
from app.ratelimit import limiter


class FakePool:
    """Minimal asyncpg.Pool stand-in.

    Queue results per method with `queue()`; each call pops the next queued
    result (or returns None when the queue is empty). Queue an Exception
    instance to make the call raise. Every call is recorded in `calls` as
    (method, query, args).
    """

    def __init__(self) -> None:
        self.results: dict[str, list] = {}
        self.calls: list[tuple[str, str, tuple]] = []

    def queue(self, method: str, result) -> None:
        self.results.setdefault(method, []).append(result)

    async def _call(self, method: str, query: str, args: tuple):
        self.calls.append((method, query, args))
        queued = self.results.get(method)
        result = queued.pop(0) if queued else None
        if isinstance(result, Exception):
            raise result
        return result

    async def fetchrow(self, query: str, *args):
        return await self._call("fetchrow", query, args)

    async def fetchval(self, query: str, *args):
        return await self._call("fetchval", query, args)

    async def fetch(self, query: str, *args):
        return await self._call("fetch", query, args) or []

    async def execute(self, query: str, *args):
        return await self._call("execute", query, args)


@pytest.fixture
def fake_pool(monkeypatch) -> FakePool:
    pool = FakePool()
    monkeypatch.setattr(db, "_pool", pool)
    return pool


def make_app(*routers) -> FastAPI:
    """A minimal app with just the routers under test (rate limiter wired up,
    as main.py does), so tests don't import app.main and its full module tree."""
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    for router in routers:
        app.include_router(router)
    return app


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """The slowapi limiter is module-global; reset its counters between tests
    so one test's login attempts can't 429 another's."""
    limiter.reset()
    yield
