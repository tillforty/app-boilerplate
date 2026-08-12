"""Shared per-IP rate limiter (slowapi) for sensitive/auth endpoints.

Kept in its own module so routers (auth, settings) can import the limiter and
decorate their endpoints without importing main — which would be a circular
import. main.py registers this limiter on the app (`app.state.limiter`) and
installs the 429 handler for RateLimitExceeded.

Decorated endpoints MUST take a `request: starlette.requests.Request` parameter;
slowapi reads the client IP from it (via get_remote_address).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

# Per-IP key. Behind a reverse proxy, ensure X-Forwarded-For is trusted/handled
# upstream if you need the real client IP.
limiter = Limiter(key_func=get_remote_address)
