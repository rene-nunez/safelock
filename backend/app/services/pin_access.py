from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from fastapi.concurrency import run_in_threadpool

from app.core.security import verify_password

if TYPE_CHECKING:
    from app.schemas.mqtt import MessageEnvelope
    from app.services.mqtt_gateway import MqttGateway

PIN_LOCK_THRESHOLD = 5
PIN_LOCK_MINUTES = 5


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
) -> None:
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
    except Exception:
        return


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

    locked_until = credential.get("pin_locked_until")
    now = datetime.now(UTC)
    if isinstance(locked_until, datetime) and locked_until > now:
        await deny("pin_locked")
        return

    ok = await run_in_threadpool(verify_password, pin, pin_hash)
    if not ok:
        fails = int(credential.get("pin_fails", 0)) + 1
        updates: dict[str, Any] = {"pin_fails": fails, "updated_at": now}
        reason = "pin_bad"
        if fails >= PIN_LOCK_THRESHOLD:
            updates["pin_locked_until"] = now + timedelta(minutes=PIN_LOCK_MINUTES)
            updates["pin_fails"] = 0
            reason = "pin_locked"
        await db.credentials.update_one({"_id": credential["_id"]}, {"$set": updates})
        await deny(reason)
        return

    # success: clear fail counters
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
    if not published:
        await _insert_event(
            gateway,
            device_id=device_id,
            envelope=envelope,
            decision="denied",
            reason="backend_unreachable",
            uid=uid,
            credential_id=credential_id,
        )
        return

    await _insert_event(
        gateway,
        device_id=device_id,
        envelope=envelope,
        decision="granted",
        reason="pin_ok",
        uid=uid,
        credential_id=credential_id,
    )
