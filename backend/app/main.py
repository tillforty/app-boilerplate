"""Tillforty app boilerplate — API layer.

FastAPI app wiring auth + encrypted vault + file storage on top of Postgres.
Add your own routers below. Designed to run behind a reverse proxy at /api
(uvicorn --root-path /api makes /api/docs work).
"""
import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import db, files, oauth, roles, vault, vectors
from .auth import ensure_schema_and_seed, router as auth_router

DATABASE_URL = os.environ["DATABASE_URL"]

app = FastAPI(title="Tillforty App API")


@app.on_event("startup")
async def startup() -> None:
    await db.connect(DATABASE_URL)
    await ensure_schema_and_seed()
    # roles must run after auth: it ALTERs/backfills the users table.
    await roles.ensure_schema_and_seed()
    await vault.ensure_schema()
    await files.ensure_schema()
    await vectors.ensure_schema()


@app.on_event("shutdown")
async def shutdown() -> None:
    await db.disconnect()


app.include_router(auth_router)
app.include_router(oauth.router)
app.include_router(roles.router)
app.include_router(vault.router)
app.include_router(files.router)
# Register your app-specific routers here.


@app.get("/health")
async def health() -> dict:
    """Liveness: does the process answer? (used by uptime checks)."""
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness: can we reach Postgres?"""
    checks: dict[str, str] = {}
    try:
        async with db.get_pool().acquire() as conn:
            await conn.fetchval("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001 - report any failure verbatim
        checks["postgres"] = f"error: {exc}"

    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"ready": healthy, "checks": checks},
    )


@app.get("/")
async def root() -> dict:
    return {"service": "tillforty-app-api"}
