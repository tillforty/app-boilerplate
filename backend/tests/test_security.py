"""Unit tests for password hashing and JWT tokens (app/security.py)."""
import datetime as dt

import jwt
import pytest

from app import security


class TestPasswordHashing:
    def test_hash_and_verify_roundtrip(self):
        h = security.hash_password("correct horse battery staple")
        assert h != "correct horse battery staple"
        assert security.verify_password("correct horse battery staple", h)

    def test_wrong_password_fails(self):
        h = security.hash_password("right")
        assert not security.verify_password("wrong", h)

    def test_same_password_hashes_differently(self):
        # bcrypt salts every hash — equal inputs must not produce equal hashes.
        assert security.hash_password("pw") != security.hash_password("pw")

    def test_malformed_hash_returns_false_instead_of_raising(self):
        assert security.verify_password("pw", "not-a-bcrypt-hash") is False
        assert security.verify_password("pw", "") is False

    def test_long_password_is_truncated_consistently(self):
        # bcrypt only reads the first 72 bytes; hashing and verifying must agree
        # on the truncation so a >72-byte password still verifies (and a request
        # can never crash on one).
        long_pw = "x" * 100
        h = security.hash_password(long_pw)
        assert security.verify_password(long_pw, h)
        # Documents the truncation: differences past byte 72 are not seen.
        assert security.verify_password("x" * 72 + "different-tail", h)
        # ...but a difference inside the first 72 bytes is.
        assert not security.verify_password("y" * 100, h)

    def test_unicode_password_roundtrip(self):
        pw = "pässwörd-日本語-🔒"
        assert security.verify_password(pw, security.hash_password(pw))


class TestAccessTokens:
    def test_roundtrip_preserves_subject(self):
        token = security.create_access_token("42")
        payload = security.decode_token(token)
        assert payload["sub"] == "42"

    def test_token_expiry_is_in_the_future(self):
        payload = security.decode_token(security.create_access_token("1"))
        now = dt.datetime.now(dt.timezone.utc).timestamp()
        assert payload["iat"] <= now
        assert payload["exp"] > now
        # Expiry honours JWT_EXPIRE_MINUTES (within a small clock tolerance).
        expected = now + security.JWT_EXPIRE_MINUTES * 60
        assert abs(payload["exp"] - expected) < 10

    def test_tampered_token_rejected(self):
        token = security.create_access_token("42")
        header, body, sig = token.split(".")
        with pytest.raises(jwt.PyJWTError):
            security.decode_token(f"{header}.{body}x.{sig}")

    def test_token_signed_with_other_secret_rejected(self):
        forged = jwt.encode({"sub": "42"}, "other-secret", algorithm="HS256")
        with pytest.raises(jwt.PyJWTError):
            security.decode_token(forged)

    def test_expired_token_rejected(self):
        past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
        expired = jwt.encode(
            {"sub": "42", "exp": int(past.timestamp())},
            security.JWT_SECRET,
            algorithm=security.JWT_ALG,
        )
        with pytest.raises(jwt.ExpiredSignatureError):
            security.decode_token(expired)

    def test_unsigned_token_rejected(self):
        # alg=none tokens must never pass verification.
        unsigned = jwt.encode({"sub": "42"}, key=None, algorithm="none")
        with pytest.raises(jwt.PyJWTError):
            security.decode_token(unsigned)
