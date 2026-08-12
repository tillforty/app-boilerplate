"""Tillforty app boilerplate — API layer.

FastAPI app wiring auth + encrypted vault + file storage on top of Postgres.
Add your own routers below. Designed to run behind a reverse proxy at /api
(uvicorn --root-path /api makes /api/docs work).
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from . import ai, customers, db, demo, development, files, llmconfig, oauth, observability, roles, settings, stats, vault, vectors
from .auth import ensure_schema_and_seed, router as auth_router
from .ratelimit import limiter

DATABASE_URL = os.environ["DATABASE_URL"]

# Initialize error monitoring as early as possible so failures during startup
# are captured too. No-op when SENTRY_DSN is unset (see observability.py).
observability.init_sentry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown: connect the pool and run the schema bootstrap in order,
    then release the pool on shutdown. (Replaces the deprecated @app.on_event.)"""
    await db.connect(DATABASE_URL)
    await ensure_schema_and_seed()
    # roles must run after auth: it ALTERs/backfills the users table.
    await roles.ensure_schema_and_seed()
    # settings must run after roles (admin upsert needs the roles table) and
    # before demo (demo seeding now reads app_settings.demo_mode).
    await settings.ensure_schema_and_seed()
    # demo must run after roles: it seeds the demo user with the member role.
    await demo.ensure_demo_user()
    await vault.ensure_schema()
    # llmconfig stores API keys in the vault, so it must run after vault.
    await llmconfig.ensure_schema()
    await files.ensure_schema()
    await vectors.ensure_schema()
    # customers must run after vectors: it declares a pgvector embedding column.
    await customers.ensure_schema()
    yield
    await db.disconnect()


app = FastAPI(title="Tillforty App API", lifespan=lifespan)

# Per-IP rate limiting (slowapi) for auth/onboarding endpoints. The limiter is
# registered on the app and the 429 handler installed here; individual endpoints
# opt in with @limiter.limit(...) (see auth.py / settings.py).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


app.include_router(auth_router)
app.include_router(demo.router)
app.include_router(oauth.router)
app.include_router(roles.router)
app.include_router(settings.router)
app.include_router(vault.router)
app.include_router(files.router)
app.include_router(stats.router)
app.include_router(ai.router)
app.include_router(customers.router)
app.include_router(development.router)
app.include_router(llmconfig.router)
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
