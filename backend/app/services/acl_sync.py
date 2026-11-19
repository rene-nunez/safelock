"""Build and publish full access-list snapshots."""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.db.mongo import Database
from app.services.devices import ONLINE_WINDOW

if TYPE_CHECKING:
    from app.services.mqtt_gateway import MqttGateway

logger = logging.getLogger(__name__)

SYNC_COMMAND = "synchronize-access-list"
COMMAND_TTL_S = 60
RESYNC_THROTTLE_S = 30

Document = dict[str, Any]


class GatewayUnavailableError(Exception):
    pass


def _epoch(value: Any) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return None


def _as_int(value: Any, default: int = 0) -> int:
    return int(value) if isinstance(value, int) else default


def is_online(device: Document) -> bool:
    last_seen = device.get("last_seen")
    return last_seen is not None and datetime.now(UTC) - last_seen < ONLINE_WINDOW


async def build_snapshot(db: Database, device_id: str) -> Document | None:
    device = await db.devices.find_one({"device_id": device_id})
    if device is None:
        return None

    credentials = [
        document
        async for document in db.credentials.find({"status": "active"})
    ]
    holder_ids = [document["holder_id"] for document in credentials]
    holders = [
        document
        async for document in db.cardholders.find(
            {"_id": {"$in": holder_ids}, "status": "active"}, {"_id": 1}
        )
    ]
    active_holders = {document["_id"] for document in holders}

    entries = [
        {
            "uid": document["uid"],
            "credential_id": str(document["_id"]),
            "holder_id": str(document["holder_id"]),
            "status": "active",
            "valid_from": _epoch(document.get("valid_from")),
            "valid_to": _epoch(document.get("valid_to")),
        }
        for document in credentials
        if document["holder_id"] in active_holders
    ]
    entries.sort(key=lambda entry: entry["uid"])

    content = {
        "entries": entries,
        "locked": bool(device.get("locked", False)),
        "offline_policy": device.get("offline_policy", "allow"),
        "requires_pin": bool(device.get("requires_pin", False)),
        "stale_acl_hours": device.get("stale_acl_hours", 72),
        "unlock_ms": device.get("unlock_ms", 3000),
    }
    serialized = json.dumps(content, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode()).hexdigest()

    desired = _as_int(
        device.get("desired_acl_version", device.get("acl_version", 0))
    )
    if digest != device.get("acl_hash"):
        desired += 1
        await db.devices.update_one(
            {"_id": device["_id"]},
            {
                "$set": {
                    "acl_hash": digest,
                    "desired_acl_version": desired,
                    "updated_at": datetime.now(UTC),
                }
            },
        )

    return {
        "request_id": str(uuid.uuid4()),
        "expires_at": int(time.time()) + COMMAND_TTL_S,
        "acl_version": desired,
        "requires_pin": content["requires_pin"],
        "locked": content["locked"],
        "offline_policy": content["offline_policy"],
        "stale_acl_hours": content["stale_acl_hours"],
        "unlock_ms": content["unlock_ms"],
        "entries": entries,
    }


async def publish_snapshot(
    db: Database, gateway: MqttGateway, device_id: str
) -> Document:
    snapshot = await build_snapshot(db, device_id)
    if snapshot is None:
        raise ValueError(f"Unknown device: {device_id}")

    if not await gateway.publish_command(device_id, SYNC_COMMAND, snapshot):
        raise GatewayUnavailableError("MQTT gateway could not publish the command")

    await db.devices.update_one(
        {"device_id": device_id},
        {
            "$set": {
                "pending_sync_request_id": snapshot["request_id"],
                "last_sync_request_at": datetime.now(UTC),
                "updated_at": datetime.now(UTC),
            }
        },
    )
    logger.info(
        "ACL sync requested device_id=%s acl_version=%s request_id=%s",
        device_id,
        snapshot["acl_version"],
        snapshot["request_id"],
    )
    return snapshot


async def _resync_if_needed(
    db: Database, gateway: MqttGateway, device_id: str
) -> None:
    device = await db.devices.find_one({"device_id": device_id})
    if device is None or not is_online(device):
        return

    # Rebuild first: the ACL may have changed while the device was offline, so
    # the stored desired version can still match what the device reports.
    snapshot = await build_snapshot(db, device_id)
    if snapshot is None:
        return
    desired = int(snapshot["acl_version"])
    reported = _as_int(device.get("acl_version"), 0)
    if reported >= desired:
        return

    last_request = device.get("last_sync_request_at")
    if (
        last_request is not None
        and (datetime.now(UTC) - last_request).total_seconds() < RESYNC_THROTTLE_S
    ):
        return

    try:
        await publish_snapshot(db, gateway, device_id)
    except (GatewayUnavailableError, ValueError):
        logger.warning("ACL auto-sync failed device_id=%s", device_id)


async def sync_on_status(
    db: Database, gateway: MqttGateway, device_id: str, reported_version: int
) -> None:
    device = await db.devices.find_one({"device_id": device_id})
    if device is None or device.get("acl_version") != reported_version:
        return
    await _resync_if_needed(db, gateway, device_id)


async def sync_on_heartbeat(
    db: Database, gateway: MqttGateway, device_id: str
) -> None:
    await _resync_if_needed(db, gateway, device_id)


async def sync_device_if_online(
    db: Database, gateway: MqttGateway, device_id: str
) -> None:
    device = await db.devices.find_one({"device_id": device_id})
    if device is None or not is_online(device):
        return
    try:
        await publish_snapshot(db, gateway, device_id)
    except (GatewayUnavailableError, ValueError):
        logger.warning("ACL sync after change failed device_id=%s", device_id)


async def sync_all_online(db: Database, gateway: MqttGateway) -> None:
    async for device in db.devices.find({}):
        if is_online(device):
            await sync_device_if_online(db, gateway, device["device_id"])


async def handle_response(
    db: Database, device_id: str, request_id: str, result: str
) -> None:
    device = await db.devices.find_one({"device_id": device_id})
    if device is None:
        return
    if device.get("pending_sync_request_id") != request_id:
        logger.debug(
            "Unexpected ACL sync response device_id=%s request_id=%s",
            device_id,
            request_id,
        )
        return

    updates: dict[str, Any] = {
        "pending_sync_request_id": None,
        "updated_at": datetime.now(UTC),
    }
    if result == "ok":
        updates["last_sync_at"] = datetime.now(UTC)
    await db.devices.update_one({"_id": device["_id"]}, {"$set": updates})
    logger.info(
        "ACL sync response device_id=%s request_id=%s result=%s",
        device_id,
        request_id,
        result,
    )
