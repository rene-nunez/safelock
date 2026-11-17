from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import Settings

ALGORITHM = "HS256"

_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)


def create_access_token(
    user_id: str, token_version: int, settings: Settings
) -> tuple[str, int]:
    expires_in = settings.access_token_ttl_minutes * 60
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user_id,
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), expires_in


def decode_access_token(token: str, settings: Settings) -> tuple[str, int] | None:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except jwt.InvalidTokenError:
        return None

    subject = payload.get("sub")
    version = payload.get("ver", 0)
    if not isinstance(subject, str) or not isinstance(version, int):
        return None
    return subject, version
