from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.deps import get_current_admin, get_current_user, get_db, get_gateway
from app.api.v1.common import Limit, Offset, actor_object_id, client_ip
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.schemas.cardholders import (
    CardholderCreate,
    CardholderOut,
    CardholderUpdate,
)
from app.schemas.credentials import CredentialCreate, CredentialOut
from app.services import acl_sync
from app.services.audit import record_audit
from app.services.cardholders import (
    cardholder_has_history,
    cardholder_to_out,
    create_cardholder,
    delete_cardholder,
    get_cardholder,
    list_cardholders,
    update_cardholder,
)
from app.services.credentials import (
    CredentialAlreadyExistsError,
    create_credential,
    credential_to_out,
    list_holder_credentials,
    restore_holder_credentials,
    revoke_holder_credentials,
)
from app.services.mqtt_gateway import MqttGateway

router = APIRouter(prefix="/cardholders", tags=["cardholders"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
AdminUser = Annotated[UserOut, Depends(get_current_admin)]
Db = Annotated[Database, Depends(get_db)]
Gateway = Annotated[MqttGateway | None, Depends(get_gateway)]


async def _require_cardholder(db: Database, cardholder_id: str) -> dict[str, Any]:
    cardholder = await get_cardholder(db, cardholder_id)
    if cardholder is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cardholder not found"
        )
    return cardholder


def _snapshot(cardholder: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": cardholder["name"],
        "email": cardholder.get("email"),
        "unit": cardholder.get("unit"),
        "status": cardholder.get("status", "active"),
    }


async def _sync_acl(db: Database, gateway: MqttGateway | None) -> None:
    if gateway is not None:
        await acl_sync.sync_all_online(db, gateway)


@router.get("", response_model=list[CardholderOut])
async def get_cardholders(
    db: Db, _: CurrentUser, limit: Limit = 100, offset: Offset = 0
) -> list[CardholderOut]:
    documents = await list_cardholders(db, limit=limit, offset=offset)
    return [cardholder_to_out(document) for document in documents]


@router.post("", response_model=CardholderOut, status_code=status.HTTP_201_CREATED)
async def create_cardholder_endpoint(
    payload: CardholderCreate,
    request: Request,
    db: Db,
    user: CurrentUser,
) -> CardholderOut:
    document = await create_cardholder(db, payload)
    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="cardholder.create",
        target=str(document["_id"]),
        after={
            "name": document["name"],
            "email": document.get("email"),
            "unit": document.get("unit"),
        },
        ip=client_ip(request),
    )
    return cardholder_to_out(document)


@router.get("/{cardholder_id}", response_model=CardholderOut)
async def get_cardholder_endpoint(
    cardholder_id: str, db: Db, _: CurrentUser
) -> CardholderOut:
    return cardholder_to_out(await _require_cardholder(db, cardholder_id))


@router.patch("/{cardholder_id}", response_model=CardholderOut)
async def update_cardholder_endpoint(
    cardholder_id: str,
    payload: CardholderUpdate,
    request: Request,
    db: Db,
    user: CurrentUser,
    gateway: Gateway,
) -> CardholderOut:
    target = await _require_cardholder(db, cardholder_id)
    updates: dict[str, Any] = payload.model_dump(exclude_unset=True)

    for field in ("name", "unit"):
        value = updates.get(field)
        if isinstance(value, str):
            updates[field] = value.strip()
    if "email" in updates and updates["email"] is not None:
        updates["email"] = str(updates["email"]).strip().lower()

    updated = await update_cardholder(db, target["_id"], updates)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cardholder not found"
        )

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="cardholder.update",
        target=str(target["_id"]),
        before={
            "name": target["name"],
            "email": target.get("email"),
            "unit": target.get("unit"),
            "status": target.get("status", "active"),
        },
        after=updates,
        ip=client_ip(request),
    )

    deactivated = (
        target.get("status", "active") == "active"
        and updates.get("status") == "inactive"
    )
    if deactivated:
        revoked = await revoke_holder_credentials(
            db, target["_id"], reason="cardholder_inactive"
        )
        for credential in revoked:
            await record_audit(
                db,
                actor_id=actor_object_id(user),
                action="credential.revoke",
                target=credential["uid"],
                after={"reason": "cardholder_inactive"},
                ip=client_ip(request),
            )
        if revoked:
            await record_audit(
                db,
                actor_id=actor_object_id(user),
                action="credential.revoke_all",
                target=str(target["_id"]),
                after={"count": len(revoked)},
                ip=client_ip(request),
            )

    await _sync_acl(db, gateway)
    return cardholder_to_out(updated)


@router.post("/{cardholder_id}/activate-and-restore", response_model=CardholderOut)
async def activate_and_restore_cardholder(
    cardholder_id: str,
    request: Request,
    db: Db,
    admin: AdminUser,
    gateway: Gateway,
) -> CardholderOut:
    target = await _require_cardholder(db, cardholder_id)
    if target.get("status", "active") == "active":
        return cardholder_to_out(target)

    try:
        restored = await restore_holder_credentials(db, target["_id"])
    except CredentialAlreadyExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error

    updated = await update_cardholder(db, target["_id"], {"status": "active"})
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cardholder not found"
        )

    await record_audit(
        db,
        actor_id=actor_object_id(admin),
        action="cardholder.update",
        target=str(target["_id"]),
        before=_snapshot(target),
        after={"status": "active", "restored_credentials": len(restored)},
        ip=client_ip(request),
    )
    for credential in restored:
        await record_audit(
            db,
            actor_id=actor_object_id(admin),
            action="credential.restore",
            target=credential["uid"],
            after={"reason": "cardholder_activation"},
            ip=client_ip(request),
        )

    await _sync_acl(db, gateway)
    return cardholder_to_out(updated)


@router.delete("/{cardholder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cardholder_endpoint(
    cardholder_id: str,
    request: Request,
    db: Db,
    admin: AdminUser,
) -> Response:
    target = await _require_cardholder(db, cardholder_id)
    if await cardholder_has_history(db, target):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The cardholder has credentials or history; deactivate it instead",
        )

    await delete_cardholder(db, target)
    await record_audit(
        db,
        actor_id=actor_object_id(admin),
        action="cardholder.delete",
        target=str(target["_id"]),
        before=_snapshot(target),
        ip=client_ip(request),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{cardholder_id}/credentials", response_model=list[CredentialOut])
async def get_holder_credentials(
    cardholder_id: str,
    db: Db,
    _: CurrentUser,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[CredentialOut]:
    cardholder = await _require_cardholder(db, cardholder_id)
    documents = await list_holder_credentials(
        db, cardholder["_id"], limit=limit, offset=offset
    )
    return [credential_to_out(document) for document in documents]


@router.post(
    "/{cardholder_id}/credentials",
    response_model=CredentialOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_holder_credential(
    cardholder_id: str,
    payload: CredentialCreate,
    request: Request,
    db: Db,
    user: CurrentUser,
    gateway: Gateway,
) -> CredentialOut:
    cardholder = await _require_cardholder(db, cardholder_id)
    if cardholder.get("status", "active") != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot add credentials to an inactive cardholder",
        )

    try:
        document = await create_credential(db, cardholder["_id"], payload)
    except CredentialAlreadyExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="credential.create",
        target=document["uid"],
        after={
            "holder_id": str(document["holder_id"]),
            "uid": document["uid"],
            "has_pin": document.get("pin_hash") is not None,
        },
        ip=client_ip(request),
    )
    await _sync_acl(db, gateway)
    return credential_to_out(document)


@router.post(
    "/{cardholder_id}/credentials/revoke-all",
    response_model=list[CredentialOut],
)
async def revoke_all_holder_credentials(
    cardholder_id: str,
    request: Request,
    db: Db,
    user: CurrentUser,
    gateway: Gateway,
) -> list[CredentialOut]:
    cardholder = await _require_cardholder(db, cardholder_id)
    revoked = await revoke_holder_credentials(db, cardholder["_id"])
    for credential in revoked:
        await record_audit(
            db,
            actor_id=actor_object_id(user),
            action="credential.revoke",
            target=credential["uid"],
            after={"reason": "revoke_all"},
            ip=client_ip(request),
        )
    if revoked:
        await record_audit(
            db,
            actor_id=actor_object_id(user),
            action="credential.revoke_all",
            target=str(cardholder["_id"]),
            after={"count": len(revoked)},
            ip=client_ip(request),
        )
    await _sync_acl(db, gateway)
    return [credential_to_out(document) for document in revoked]
