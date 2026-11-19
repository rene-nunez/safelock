from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool

from app.api.deps import get_current_admin, get_current_user, get_db, get_gateway
from app.api.v1.common import actor_object_id, client_ip
from app.core.security import hash_password
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.schemas.credentials import (
    CredentialOut,
    CredentialUpdate,
    validate_window,
)
from app.services import acl_sync
from app.services.audit import record_audit
from app.services.credentials import (
    CredentialAlreadyExistsError,
    CredentialHasEventsError,
    credential_to_out,
    delete_credential,
    get_credential,
    restore_credential,
    revoke_credential,
    update_credential,
)
from app.services.mqtt_gateway import MqttGateway

router = APIRouter(prefix="/credentials", tags=["credentials"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
AdminUser = Annotated[UserOut, Depends(get_current_admin)]
Db = Annotated[Database, Depends(get_db)]
Gateway = Annotated[MqttGateway | None, Depends(get_gateway)]


async def _require_credential(db: Database, credential_id: str) -> dict[str, Any]:
    credential = await get_credential(db, credential_id)
    if credential is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        )
    return credential


def _snapshot(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "uid": document["uid"],
        "holder_id": str(document["holder_id"]),
        "status": document.get("status", "active"),
        "has_pin": document.get("pin_hash") is not None,
    }


async def _sync_acl(db: Database, gateway: MqttGateway | None) -> None:
    if gateway is not None:
        await acl_sync.sync_all_online(db, gateway)


@router.patch("/{credential_id}", response_model=CredentialOut)
async def update_credential_endpoint(
    credential_id: str,
    payload: CredentialUpdate,
    request: Request,
    db: Db,
    user: CurrentUser,
    gateway: Gateway,
) -> CredentialOut:
    target = await _require_credential(db, credential_id)
    updates: dict[str, Any] = payload.model_dump(exclude_unset=True)
    updates.pop("clear_pin", None)
    updates.pop("pin", None)

    if payload.pin is not None and payload.clear_pin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="pin and clear_pin cannot be used together",
        )

    if payload.pin is not None:
        updates["pin_hash"] = await run_in_threadpool(hash_password, payload.pin)
        updates["pin_fails"] = 0
        updates["pin_locked_until"] = None
    elif payload.clear_pin:
        updates["pin_hash"] = None
        updates["pin_fails"] = 0
        updates["pin_locked_until"] = None

    valid_from = updates.get("valid_from", target.get("valid_from"))
    valid_to = updates.get("valid_to", target.get("valid_to"))
    try:
        validate_window(valid_from, valid_to)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
        ) from error

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one field must be provided",
        )

    updated = await update_credential(db, target["_id"], updates)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        )

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="credential.update",
        target=target["uid"],
        before=_snapshot(target),
        after=_snapshot(updated),
        ip=client_ip(request),
    )
    await _sync_acl(db, gateway)
    return credential_to_out(updated)


@router.post("/{credential_id}/revoke", response_model=CredentialOut)
async def revoke_credential_endpoint(
    credential_id: str,
    request: Request,
    db: Db,
    user: CurrentUser,
    gateway: Gateway,
) -> CredentialOut:
    target = await _require_credential(db, credential_id)
    if target.get("status") == "revoked":
        return credential_to_out(target)

    updated = await revoke_credential(db, target)
    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="credential.revoke",
        target=target["uid"],
        before=_snapshot(target),
        after=_snapshot(updated),
        ip=client_ip(request),
    )
    await _sync_acl(db, gateway)
    return credential_to_out(updated)


@router.post("/{credential_id}/restore", response_model=CredentialOut)
async def restore_credential_endpoint(
    credential_id: str,
    request: Request,
    db: Db,
    admin: AdminUser,
    gateway: Gateway,
) -> CredentialOut:
    target = await _require_credential(db, credential_id)
    if target.get("status") == "active":
        return credential_to_out(target)

    holder = await db.cardholders.find_one({"_id": target["holder_id"]})
    if holder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cardholder not found"
        )
    if holder.get("status", "active") != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot restore a credential while the cardholder is inactive",
        )

    try:
        updated = await restore_credential(db, target)
    except CredentialAlreadyExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=actor_object_id(admin),
        action="credential.restore",
        target=target["uid"],
        before=_snapshot(target),
        after=_snapshot(updated),
        ip=client_ip(request),
    )
    await _sync_acl(db, gateway)
    return credential_to_out(updated)


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential_endpoint(
    credential_id: str,
    request: Request,
    db: Db,
    user: CurrentUser,
    gateway: Gateway,
) -> Response:
    target = await _require_credential(db, credential_id)
    try:
        await delete_credential(db, target)
    except CredentialHasEventsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="credential.delete",
        target=target["uid"],
        before=_snapshot(target),
        ip=client_ip(request),
    )
    await _sync_acl(db, gateway)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
