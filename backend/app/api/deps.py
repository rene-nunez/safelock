from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.security import decode_access_token
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.services.mqtt_gateway import MqttGateway
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


def get_gateway(request: Request) -> MqttGateway | None:
    """The gateway is optional in tests, which do not run the lifespan."""
    return cast("MqttGateway | None", getattr(request.app.state, "gateway", None))


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

    claims = decode_access_token(credentials.credentials, settings)
    if claims is None:
        raise _unauthorized("Invalid or expired token")
    user_id, token_version = claims

    user = await get_user_by_id(db, user_id)
    if user is None or not user.get("active", False):
        raise _unauthorized("User is not active")
    if user.get("token_version", 0) != token_version:
        raise _unauthorized("Session is no longer valid")

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
