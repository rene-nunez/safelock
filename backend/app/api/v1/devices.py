from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.deps import get_current_admin, get_current_user, get_db
from app.api.v1.common import actor_object_id, client_ip
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.schemas.devices import DeviceCreate, DeviceOut, DeviceUpdate
from app.services.audit import record_audit
from app.services.devices import (
    DeviceAlreadyExistsError,
    create_device,
    delete_device,
    device_has_history,
    device_to_out,
    get_device,
    list_devices,
    update_device,
)

router = APIRouter(prefix="/devices", tags=["devices"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
AdminUser = Annotated[UserOut, Depends(get_current_admin)]
Db = Annotated[Database, Depends(get_db)]


async def _require_device(db: Database, device_id: str) -> dict[str, Any]:
    device = await get_device(db, device_id)
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        )
    return device


def _snapshot(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "device_id": document["device_id"],
        "name": document["name"],
        "site": document.get("site"),
        "status": document.get("status", "active"),
        "offline_policy": document.get("offline_policy", "allow"),
        "stale_acl_hours": document.get("stale_acl_hours", 72),
        "unlock_ms": document.get("unlock_ms", 3000),
        "requires_pin": document.get("requires_pin", False),
        "locked": document.get("locked", False),
        "location": document.get("location"),
    }


@router.get("", response_model=list[DeviceOut])
async def get_devices(db: Db, _: CurrentUser) -> list[DeviceOut]:
    return [device_to_out(document) for document in await list_devices(db)]


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device_endpoint(device_id: str, db: Db, _: CurrentUser) -> DeviceOut:
    return device_to_out(await _require_device(db, device_id))


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
async def create_device_endpoint(
    payload: DeviceCreate,
    request: Request,
    db: Db,
    admin: AdminUser,
) -> DeviceOut:
    try:
        document = await create_device(db, payload)
    except DeviceAlreadyExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=actor_object_id(admin),
        action="device.create",
        target=document["device_id"],
        after=_snapshot(document),
        ip=client_ip(request),
    )
    return device_to_out(document)


@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device_endpoint(
    device_id: str,
    payload: DeviceUpdate,
    request: Request,
    db: Db,
    user: CurrentUser,
) -> DeviceOut:
    target = await _require_device(db, device_id)

    updates: dict[str, Any] = payload.model_dump(exclude_unset=True)
    for field in ("name", "site"):
        value = updates.get(field)
        if isinstance(value, str):
            updates[field] = value.strip()

    if user.role != "admin" and set(updates) - {"locked"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can change device settings",
        )

    updated = await update_device(db, target["_id"], updates)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        )

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="device.update",
        target=target["device_id"],
        before=_snapshot(target),
        after=_snapshot(updated),
        ip=client_ip(request),
    )
    return device_to_out(updated)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device_endpoint(
    device_id: str,
    request: Request,
    db: Db,
    admin: AdminUser,
) -> Response:
    target = await _require_device(db, device_id)
    if await device_has_history(db, target):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The device has history; retire it instead of deleting it",
        )

    await delete_device(db, target)
    await record_audit(
        db,
        actor_id=actor_object_id(admin),
        action="device.delete",
        target=target["device_id"],
        before=_snapshot(target),
        ip=client_ip(request),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
