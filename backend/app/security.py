"""Password hashing (bcrypt) and JWT access tokens."""
import datetime as dt
import os

import bcrypt
import jwt

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALG = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "720"))

if not JWT_SECRET:
    # An empty secret would sign every token with "" — anyone could forge a
    # valid token. Refuse to start rather than boot in a trivially-bypassable
    # state. start.sh / setup.sh generate this automatically.
    raise RuntimeError(
        "JWT_SECRET is not set. Generate one (e.g. `openssl rand -hex 32`) and "
        "set it in the environment before starting the API."
    )

# bcrypt only hashes the first 72 bytes; longer inputs are silently truncated
# (and some bcrypt builds raise). Truncate explicitly so hashing/verifying are
# consistent and a >72-byte password can never crash a request.
_BCRYPT_MAX_BYTES = 72


def _bcrypt_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bcrypt_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_bcrypt_bytes(password), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(minutes=JWT_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
