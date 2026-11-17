from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.security import decode_access_token
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.services.users import get_user_by_id, user_to_out

bearer_scheme = HTTPBearer(auto_error=False)


def get_db(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )
    return cast(Database, db)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    db: Annotated[Database, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserOut:
    if credentials is None:
        raise _unauthorized("Missing bearer token")

    user_id = decode_access_token(credentials.credentials, settings)
    if user_id is None:
        raise _unauthorized("Invalid or expired token")

    user = await get_user_by_id(db, user_id)
    if user is None or not user.get("active", False):
        raise _unauthorized("User is not active")

    return user_to_out(user)


async def get_current_admin(
    user: Annotated[UserOut, Depends(get_current_user)],
) -> UserOut:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator role required",
        )
    return user
