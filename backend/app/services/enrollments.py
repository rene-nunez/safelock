from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from bson import ObjectId
from pymongo import DESCENDING, ReturnDocument

from app.db.mongo import Database
from app.schemas.credentials import CredentialCreate
from app.services import acl_sync
from app.services.credentials import CredentialAlreadyExistsError, create_credential
from app.services.devices import ONLINE_WINDOW, get_device

if TYPE_CHECKING:
    from app.services.mqtt_gateway import MqttGateway

ENROLLMENT_TTL_S = 60
EnrollmentDocument = dict[str, Any]


class EnrollmentError(Exception):
    pass


class DeviceOfflineError(EnrollmentError):
    pass


class EnrollmentNotFoundError(EnrollmentError):
    pass


class EnrollmentStateError(EnrollmentError):
    pass


class EnrollmentActiveError(EnrollmentError):
    pass


def _expires_at(doc: EnrollmentDocument) -> datetime:
    created = doc["created_at"]
    if isinstance(created, datetime):
        return created + timedelta(seconds=ENROLLMENT_TTL_S)
    return datetime.now(UTC)


def enrollment_to_out(doc: EnrollmentDocument) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "device_id": doc["device_id"],
        "request_id": doc["request_id"],
        "status": doc.get("status", "pending"),
        "uid": doc.get("uid"),
        "requested_by": str(doc["requested_by"]) if doc.get("requested_by") else None,
        "created_at": doc["created_at"],
        "expires_at": _expires_at(doc),
        "scanned_at": doc.get("scanned_at"),
    }


async def create_enrollment(
    db: Database,
    gateway: MqttGateway | None,
    device_ref: str,
    requested_by: ObjectId | None,
) -> EnrollmentDocument:
    device = await get_device(db, device_ref)
    if device is None:
        device = await db.devices.find_one({"device_id": device_ref})
    if device is None:
        raise EnrollmentNotFoundError("Device not found")
    last_seen = device.get("last_seen")
    if last_seen is None or datetime.now(UTC) - last_seen >= ONLINE_WINDOW:
        raise DeviceOfflineError("The device is offline")
    if gateway is None:
        raise EnrollmentError("MQTT gateway unavailable")

    now = datetime.now(UTC)
    active_cutoff = now - timedelta(seconds=ENROLLMENT_TTL_S)
    active = await db.enrollments.find_one(
        {
            "device_id": device["device_id"],
            "status": {"$in": ["pending", "scanned"]},
            "created_at": {"$gt": active_cutoff},
        },
        sort=[("created_at", DESCENDING)],
    )
    if active is not None:
        raise EnrollmentActiveError("Device already has an active enrollment")

    request_id = str(uuid.uuid4())
    expires_at = int(time.time()) + ENROLLMENT_TTL_S
    doc: EnrollmentDocument = {
        "device_id": device["device_id"],
        "request_id": request_id,
        "requested_by": requested_by,
        "status": "pending",
        "uid": None,
        "scanned_at": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.enrollments.insert_one(doc)
    doc["_id"] = result.inserted_id

    published = await gateway.publish_command(
        device["device_id"],
        "enroll",
        {
            "request_id": request_id,
            "ttl_s": ENROLLMENT_TTL_S,
            "expires_at": expires_at,
        },
    )
    if not published:
        await db.enrollments.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "expired", "updated_at": datetime.now(UTC)}},
        )
        raise DeviceOfflineError("The device is offline")

    return doc


async def get_enrollment(db: Database, enrollment_id: str) -> EnrollmentDocument | None:
    if not ObjectId.is_valid(enrollment_id):
        return None
    return await db.enrollments.find_one({"_id": ObjectId(enrollment_id)})


async def list_enrollments(
    db: Database, *, device_id: str | None = None
) -> list[EnrollmentDocument]:
    query: dict[str, Any] = {}
    if device_id:
        query["device_id"] = device_id
    cursor = db.enrollments.find(query).sort("created_at", DESCENDING).limit(20)
    return [doc async for doc in cursor]


async def mark_scanned(
    db: Database, device_id: str, request_id: str, uid: str
) -> EnrollmentDocument | None:
    now = datetime.now(UTC)
    return await db.enrollments.find_one_and_update(
        {
            "device_id": device_id,
            "request_id": request_id,
            "status": "pending",
            "created_at": {"$gt": now - timedelta(seconds=ENROLLMENT_TTL_S)},
        },
        {
            "$set": {
                "status": "scanned",
                "uid": uid,
                "scanned_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )


async def confirm_enrollment(
    db: Database,
    gateway: MqttGateway | None,
    enrollment: EnrollmentDocument,
    holder_id: ObjectId,
    payload: Any,
) -> EnrollmentDocument:
    now = datetime.now(UTC)
    if _expires_at(enrollment) <= now:
        await db.enrollments.update_one(
            {"_id": enrollment["_id"]},
            {"$set": {"status": "expired", "updated_at": now}},
        )
        raise EnrollmentStateError("Enrollment has expired")

    if enrollment.get("status") != "scanned" or not enrollment.get("uid"):
        raise EnrollmentStateError("Enrollment has no scanned card")

    # ensure holder exists
    holder = await db.cardholders.find_one({"_id": holder_id})
    if holder is None:
        raise EnrollmentNotFoundError("Cardholder not found")

    credential_payload = CredentialCreate(
        uid=enrollment["uid"],
        valid_from=payload.valid_from,
        valid_to=payload.valid_to,
        pin=payload.pin,
    )
    try:
        await create_credential(db, holder_id, credential_payload)
    except CredentialAlreadyExistsError as error:
        raise EnrollmentStateError(str(error)) from error

    updated = await db.enrollments.find_one_and_update(
        {"_id": enrollment["_id"]},
        {"$set": {"status": "confirmed", "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    ) or enrollment

    if gateway is not None:
        await acl_sync.sync_all_online(db, gateway)
    return updated
