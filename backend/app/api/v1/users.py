from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.api.deps import get_current_admin, get_db
from app.core.security import hash_password
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.schemas.users import CreateUserRequest, UpdateUserRequest
from app.services.audit import record_audit
from app.services.users import (
    UserAlreadyExistsError,
    count_active_admins,
    create_user,
    get_user_by_id,
    list_users,
    update_user,
    user_to_out,
)

router = APIRouter(prefix="/users", tags=["users"])

AdminUser = Annotated[UserOut, Depends(get_current_admin)]
Db = Annotated[Database, Depends(get_db)]


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


@router.get("", response_model=list[UserOut])
async def get_users(db: Db, _: AdminUser) -> list[UserOut]:
    return [user_to_out(document) for document in await list_users(db)]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user_endpoint(
    payload: CreateUserRequest,
    request: Request,
    db: Db,
    admin: AdminUser,
) -> UserOut:
    try:
        user = await create_user(db, payload.email, payload.password, payload.role)
    except UserAlreadyExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=ObjectId(admin.id),
        action="user.create",
        target=user["email"],
        after={
            "email": user["email"],
            "role": user["role"],
            "active": user["active"],
        },
        ip=_client_ip(request),
    )
    return user_to_out(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user_endpoint(
    user_id: str,
    payload: UpdateUserRequest,
    request: Request,
    db: Db,
    admin: AdminUser,
) -> UserOut:
    target = await get_user_by_id(db, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    if target["_id"] == ObjectId(admin.id) and (
        payload.role is not None or payload.active is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role or status",
        )

    updates: dict[str, Any] = {}
    if payload.role is not None:
        updates["role"] = payload.role
    if payload.active is not None:
        updates["active"] = payload.active
    if payload.password is not None:
        updates["password_hash"] = await run_in_threadpool(
            hash_password, payload.password
        )

    removing_admin = (
        target["role"] == "admin"
        and target["active"]
        and (updates.get("role") == "operator" or updates.get("active") is False)
    )
    if removing_admin:
        remaining = await count_active_admins(db, exclude_id=target["_id"])
        if remaining == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one active administrator is required",
            )

    updated = await update_user(db, target["_id"], updates)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    after: dict[str, Any] = {
        "role": updated["role"],
        "active": updated["active"],
    }
    if payload.password is not None:
        after["password_changed"] = True

    await record_audit(
        db,
        actor_id=ObjectId(admin.id),
        action="user.update",
        target=updated["email"],
        before={"role": target["role"], "active": target["active"]},
        after=after,
        ip=_client_ip(request),
    )
    return user_to_out(updated)
