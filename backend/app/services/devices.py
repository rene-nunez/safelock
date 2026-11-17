from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId
from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.db.mongo import Database
from app.schemas.devices import DeviceCreate, DeviceOut

DeviceDocument = dict[str, Any]

ONLINE_WINDOW = timedelta(seconds=90)


class DeviceAlreadyExistsError(Exception):
    def __init__(self, device_id: str) -> None:
        super().__init__(f"A device with ID {device_id} already exists")
        self.device_id = device_id


class DeviceHasHistoryError(Exception):
    def __init__(self) -> None:
        super().__init__(
            "The device has history; retire it instead of deleting it"
        )


def device_to_out(document: DeviceDocument) -> DeviceOut:
    last_seen = document.get("last_seen")
    online = (
        last_seen is not None and datetime.now(UTC) - last_seen < ONLINE_WINDOW
    )
    return DeviceOut(
        id=str(document["_id"]),
        device_id=document["device_id"],
        name=document["name"],
        site=document.get("site"),
        fw=document.get("fw"),
        online=online,
        last_seen=last_seen,
        acl_version=document.get("acl_version", 0),
        last_sync_at=document.get("last_sync_at"),
        offline_policy=document.get("offline_policy", "allow"),
        stale_acl_hours=document.get("stale_acl_hours", 72),
        unlock_ms=document.get("unlock_ms", 3000),
        requires_pin=document.get("requires_pin", False),
        locked=document.get("locked", False),
        status=document.get("status", "active"),
        location=document.get("location"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


async def get_device(db: Database, device_id: str) -> DeviceDocument | None:
    if not ObjectId.is_valid(device_id):
        return None
    return await db.devices.find_one({"_id": ObjectId(device_id)})


async def list_devices(db: Database) -> list[DeviceDocument]:
    cursor = db.devices.find({}).sort("device_id", ASCENDING)
    return [document async for document in cursor]


async def create_device(db: Database, payload: DeviceCreate) -> DeviceDocument:
    now = datetime.now(UTC)
    document: DeviceDocument = {
        "device_id": payload.device_id,
        "name": payload.name.strip(),
        "site": payload.site.strip() if payload.site else None,
        "location": (
            payload.location.model_dump() if payload.location is not None else None
        ),
        "fw": None,
        "last_seen": None,
        "acl_version": 0,
        "last_sync_at": None,
        "offline_policy": payload.offline_policy,
        "stale_acl_hours": payload.stale_acl_hours,
        "unlock_ms": payload.unlock_ms,
        "requires_pin": payload.requires_pin,
        "locked": False,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await db.devices.insert_one(document)
    except DuplicateKeyError as error:
        raise DeviceAlreadyExistsError(payload.device_id) from error

    document["_id"] = result.inserted_id
    return document


async def update_device(
    db: Database, device_id: ObjectId, updates: dict[str, Any]
) -> DeviceDocument | None:
    updates["updated_at"] = datetime.now(UTC)
    return await db.devices.find_one_and_update(
        {"_id": device_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )


async def device_has_history(db: Database, document: DeviceDocument) -> bool:
    if document.get("last_seen") is not None:
        return True
    if await db.access_events.count_documents({"device_id": document["device_id"]}):
        return True
    return bool(
        await db.enrollments.count_documents({"device_id": document["device_id"]})
    )


async def delete_device(db: Database, document: DeviceDocument) -> None:
    await db.devices.delete_one({"_id": document["_id"]})
