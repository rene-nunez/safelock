from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi.concurrency import run_in_threadpool
from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.security import hash_password
from app.db.mongo import Database
from app.schemas.credentials import CredentialCreate, CredentialOut

CredentialDocument = dict[str, Any]


class CredentialAlreadyExistsError(Exception):
    def __init__(self, uid: str) -> None:
        super().__init__(f"An active credential with UID {uid} already exists")
        self.uid = uid


class CredentialHasEventsError(Exception):
    def __init__(self) -> None:
        super().__init__(
            "The credential has access events; revoke it instead of deleting it"
        )


def credential_to_out(document: CredentialDocument) -> CredentialOut:
    return CredentialOut(
        id=str(document["_id"]),
        holder_id=str(document["holder_id"]),
        uid=document["uid"],
        status=document.get("status", "active"),
        valid_from=document.get("valid_from"),
        valid_to=document.get("valid_to"),
        revoked_at=document.get("revoked_at"),
        has_pin=document.get("pin_hash") is not None,
        pin_locked_until=document.get("pin_locked_until"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


async def get_credential(
    db: Database, credential_id: str
) -> CredentialDocument | None:
    if not ObjectId.is_valid(credential_id):
        return None
    return await db.credentials.find_one({"_id": ObjectId(credential_id)})


async def list_holder_credentials(
    db: Database, holder_id: ObjectId
) -> list[CredentialDocument]:
    cursor = db.credentials.find({"holder_id": holder_id}).sort(
        "created_at", ASCENDING
    )
    return [document async for document in cursor]


async def create_credential(
    db: Database,
    holder_id: ObjectId,
    payload: CredentialCreate,
) -> CredentialDocument:
    now = datetime.now(UTC)
    pin_hash = (
        await run_in_threadpool(hash_password, payload.pin)
        if payload.pin is not None
        else None
    )
    document: CredentialDocument = {
        "holder_id": holder_id,
        "uid": payload.uid,
        "status": "active",
        "valid_from": payload.valid_from,
        "valid_to": payload.valid_to,
        "revoked_at": None,
        "revoked_reason": None,
        "pin_hash": pin_hash,
        "pin_fails": 0,
        "pin_locked_until": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await db.credentials.insert_one(document)
    except DuplicateKeyError as error:
        raise CredentialAlreadyExistsError(payload.uid) from error

    document["_id"] = result.inserted_id
    return document


async def update_credential(
    db: Database, credential_id: ObjectId, updates: dict[str, Any]
) -> CredentialDocument | None:
    updates["updated_at"] = datetime.now(UTC)
    return await db.credentials.find_one_and_update(
        {"_id": credential_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )


async def revoke_credential(
    db: Database, document: CredentialDocument
) -> CredentialDocument:
    now = datetime.now(UTC)
    return await db.credentials.find_one_and_update(
        {"_id": document["_id"]},
        {
            "$set": {
                "status": "revoked",
                "revoked_at": now,
                "revoked_reason": None,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    ) or document


async def restore_credential(
    db: Database, document: CredentialDocument
) -> CredentialDocument:
    try:
        updated = await db.credentials.find_one_and_update(
            {"_id": document["_id"]},
            {
                "$set": {
                    "status": "active",
                    "revoked_at": None,
                    "revoked_reason": None,
                    "updated_at": datetime.now(UTC),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as error:
        raise CredentialAlreadyExistsError(document["uid"]) from error
    return updated or document


async def revoke_holder_credentials(
    db: Database, holder_id: ObjectId, reason: str | None = None
) -> list[CredentialDocument]:
    documents = await list_holder_credentials(db, holder_id)
    active = [document for document in documents if document.get("status") == "active"]
    if not active:
        return []

    now = datetime.now(UTC)
    await db.credentials.update_many(
        {"holder_id": holder_id, "status": "active"},
        {
            "$set": {
                "status": "revoked",
                "revoked_at": now,
                "revoked_reason": reason,
                "updated_at": now,
            }
        },
    )
    for document in active:
        document["status"] = "revoked"
        document["revoked_at"] = now
        document["revoked_reason"] = reason
        document["updated_at"] = now
    return active


async def restore_holder_credentials(
    db: Database, holder_id: ObjectId, reason: str = "cardholder_inactive"
) -> list[CredentialDocument]:
    documents = [
        document
        for document in await list_holder_credentials(db, holder_id)
        if document.get("status") == "revoked"
        and document.get("revoked_reason") == reason
    ]
    if not documents:
        return []

    ids = [document["_id"] for document in documents]
    uids = [document["uid"] for document in documents]
    conflict = await db.credentials.find_one(
        {"uid": {"$in": uids}, "status": "active", "_id": {"$nin": ids}}
    )
    if conflict is not None:
        raise CredentialAlreadyExistsError(conflict["uid"])

    now = datetime.now(UTC)
    await db.credentials.update_many(
        {"_id": {"$in": ids}},
        {
            "$set": {
                "status": "active",
                "revoked_at": None,
                "revoked_reason": None,
                "updated_at": now,
            }
        },
    )
    for document in documents:
        document["status"] = "active"
        document["revoked_at"] = None
        document["revoked_reason"] = None
        document["updated_at"] = now
    return documents


async def delete_credential(db: Database, document: CredentialDocument) -> None:
    events = await db.access_events.count_documents(
        {"credential_id": document["_id"]}
    )
    if events:
        raise CredentialHasEventsError()
    await db.credentials.delete_one({"_id": document["_id"]})
