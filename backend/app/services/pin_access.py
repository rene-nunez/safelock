from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from fastapi.concurrency import run_in_threadpool
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.security import verify_password
from app.services.lockout import build_failure_pipeline

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.schemas.mqtt import MessageEnvelope
    from app.services.mqtt_gateway import MqttGateway

PIN_LOCK_THRESHOLD = 5
PIN_LOCK_SCHEDULE_SECONDS = [60, 5 * 60, 15 * 60, 30 * 60]


def _event_ts(gateway: MqttGateway, envelope: MessageEnvelope) -> tuple[datetime, bool]:
    now = datetime.now(UTC)
    rtc_valid = gateway._rtc_valid.get(envelope.device_id, True)
    from app.services.mqtt_gateway import FUTURE_TS_TOLERANCE_S

    degraded = (
        not rtc_valid
        or envelope.ts <= 0
        or envelope.ts > int(now.timestamp()) + FUTURE_TS_TOLERANCE_S
    )
    return (now if degraded else datetime.fromtimestamp(envelope.ts, UTC), degraded)


async def _insert_event(
    gateway: MqttGateway,
    *,
    device_id: str,
    envelope: MessageEnvelope,
    decision: str,
    reason: str,
    uid: str,
    credential_id: Any = None,
) -> bool:
    now = datetime.now(UTC)
    event_ts, degraded = _event_ts(gateway, envelope)
    doc = {
        "device_id": device_id,
        "ts": event_ts,
        "uid": uid,
        "credential_id": credential_id,
        "decision": decision,
        "reason": reason,
        "source": "pin",
        "request_id": envelope.data.get("request_id"),
        "mqtt_id": envelope.id,
        "degraded": degraded,
        "acl_version": None,
        "acl_age_s": None,
        "created_at": now,
    }
    try:
        await gateway.db.access_events.insert_one(doc)
    except DuplicateKeyError:
        return False
    except Exception:
        logger.exception(
            "Failed to store PIN access event device_id=%s reason=%s",
            device_id,
            reason,
        )
        return False
    return True


async def handle_pin_entry(
    gateway: MqttGateway,
    *,
    device_id: str,
    envelope: MessageEnvelope,
    uid: str,
    pin: str,
    request_id: str,
) -> None:
    db = gateway.db
    device = await db.devices.find_one({"device_id": device_id})
    if device is None:
        return

    credential = await db.credentials.find_one({"uid": uid, "status": "active"})
    credential_id = credential["_id"] if credential else None

    async def deny(reason: str) -> None:
        await _insert_event(
            gateway,
            device_id=device_id,
            envelope=envelope,
            decision="denied",
            reason=reason,
            uid=uid,
            credential_id=credential_id,
        )

    if device.get("locked", False):
        await deny("door_locked")
        return

    if credential is None:
        await deny("acl_absent")
        return

    holder = await db.cardholders.find_one(
        {"_id": credential["holder_id"], "status": "active"}
    )
    if holder is None:
        await deny("acl_absent")
        return

    if not device.get("requires_pin", False):
        # PIN entry on a non-PIN door is invalid; deny.
        await deny("no_pin_set")
        return

    pin_hash = credential.get("pin_hash")
    if not pin_hash:
        await deny("no_pin_set")
        return

    now = datetime.now(UTC)
    valid_from = credential.get("valid_from")
    valid_to = credential.get("valid_to")
    if isinstance(valid_from, datetime) and valid_from > now:
        await deny("not_yet_valid")
        return
    if isinstance(valid_to, datetime) and valid_to <= now:
        await deny("credential_expired")
        return

    locked_until = credential.get("pin_locked_until")
    if isinstance(locked_until, datetime) and locked_until > now:
        await deny("pin_locked")
        return

    ok = await run_in_threadpool(verify_password, pin, pin_hash)
    if not ok:
        updated = await db.credentials.find_one_and_update(
            {"_id": credential["_id"]},
            build_failure_pipeline(
                failures_field="pin_fails",
                locked_until_field="pin_locked_until",
                now=now,
                threshold=PIN_LOCK_THRESHOLD,
                schedule_seconds=PIN_LOCK_SCHEDULE_SECONDS,
            ),
            return_document=ReturnDocument.AFTER,
        )
        locked_now = (
            updated is not None
            and isinstance(updated.get("pin_locked_until"), datetime)
            and updated["pin_locked_until"] > now
        )
        await deny("pin_locked" if locked_now else "pin_bad")
        return

    # Claim the event before opening: mqtt_id is unique, so a replay cannot
    # publish a second unlock even if the in-memory dedupe cache was lost.
    inserted = await _insert_event(
        gateway,
        device_id=device_id,
        envelope=envelope,
        decision="denied",
        reason="pin_pending",
        uid=uid,
        credential_id=credential_id,
    )
    if not inserted:
        return

    await db.credentials.update_one(
        {"_id": credential["_id"]},
        {"$set": {"pin_fails": 0, "pin_locked_until": None, "updated_at": now}},
    )

    unlock_ms = int(device.get("unlock_ms", 3000))
    expires_at = int(time.time()) + 30
    published = await gateway.publish_command(
        device_id,
        "unlock",
        {"request_id": request_id, "duration_ms": unlock_ms, "expires_at": expires_at},
    )
    await db.access_events.update_one(
        {"mqtt_id": envelope.id},
        {
            "$set": {
                "decision": "granted" if published else "denied",
                "reason": "pin_ok" if published else "backend_unreachable",
            }
        },
    )
