from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, get_db
from app.core.config import Settings, get_settings
from app.core.security import create_access_token
from app.db.mongo import Database
from app.schemas.auth import LoginRequest, TokenResponse, UserOut
from app.services.auth import authenticate
from app.services.login_throttle import (
    check_login_allowed,
    clear_login_failures,
    register_login_failure,
)
from app.services.users import normalize_email

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    email = normalize_email(str(payload.email))
    throttle = await check_login_allowed(db, email)
    if not throttle.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
            headers={"Retry-After": str(throttle.retry_after)},
        )

    user = await authenticate(db, payload.email, payload.password)
    if user is None:
        failure = await register_login_failure(db, email)
        if not failure.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
                headers={"Retry-After": str(failure.retry_after)},
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    await clear_login_failures(db, email)
    token, expires_in = create_access_token(
        str(user["_id"]), user.get("token_version", 0), settings
    )
    return TokenResponse(access_token=token, expires_in=expires_in)


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[UserOut, Depends(get_current_user)]) -> UserOut:
    return user
