import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient
from pymongo.errors import PyMongoError

from app.core.config import Settings
from app.db.mongo import Database
from app.schemas.devices import DeviceCreate
from app.services.devices import create_device
from app.services.mqtt_gateway import MqttGateway

DEVICE_ID = "sl-0001"
BASE = f"safelock/devices/{DEVICE_ID}"


def message(
    data: dict[str, Any], *, ts: int | None = None, message_id: str | None = None
) -> bytes:
    return json.dumps(
        {
            "id": message_id or str(uuid.uuid4()),
            "ts": int(time.time()) if ts is None else ts,
            "device_id": DEVICE_ID,
            "data": data,
        }
    ).encode()


def gateway(db: Database) -> MqttGateway:
    return MqttGateway(db, Settings(mqtt_url="mqtt://127.0.0.1:1883"))


async def make_device(db: Database) -> None:
    await create_device(db, DeviceCreate(device_id=DEVICE_ID, name="Front door"))


async def test_status_updates_device_metadata(db: Database) -> None:
    await make_device(db)
    await gateway(db).handle_message(
        f"{BASE}/status",
        message(
            {
                "online": True,
                "fw": "0.1.0",
                "acl_version": 3,
                "requires_pin": False,
                "locked": True,
                "lock": "locked",
            }
        ),
    )

    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    assert device["online"] is True
    assert device["last_seen"] is not None
    assert device["fw"] == "0.1.0"
    assert device["acl_version"] == 3
    assert device["locked"] is True


async def test_heartbeat_updates_last_seen(db: Database) -> None:
    await make_device(db)
    await db.devices.update_one(
        {"device_id": DEVICE_ID},
        {"$set": {"last_seen": datetime.now(UTC) - timedelta(hours=1)}},
    )
    await gateway(db).handle_message(
        f"{BASE}/heartbeat",
        message(
            {
                "uptime_s": 42,
                "rssi": -58,
                "rtc_valid": True,
                "free_heap": 180000,
            }
        ),
    )

    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    assert device["online"] is True
    assert device["telemetry"]["rtc_valid"] is True
    assert datetime.now(UTC) - device["last_seen"] < timedelta(seconds=5)


async def test_lwt_marks_device_offline(db: Database) -> None:
    await make_device(db)
    net = gateway(db)
    payload = message({"online": False})
    await net.handle_message(f"{BASE}/status", message({"online": True}))
    await net.handle_message(f"{BASE}/status", payload)
    # The broker may deliver the retained LWT more than once.
    await net.handle_message(f"{BASE}/status", payload)

    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    assert device["online"] is False


async def test_duplicate_message_id_is_discarded(db: Database) -> None:
    await make_device(db)
    net = gateway(db)
    payload = message(
        {
            "decision": "granted",
            "reason": "acl_match",
            "source": "card",
            "uid": "AA:BB:CC:DD",
            "acl_version": 3,
            "acl_age_s": 120,
        },
        message_id=str(uuid.uuid4()),
    )
    await net.handle_message(f"{BASE}/events/access-decision", payload)
    await net.handle_message(f"{BASE}/events/access-decision", payload)

    assert await db.access_events.count_documents({}) == 1


async def test_invalid_messages_are_discarded(db: Database) -> None:
    await make_device(db)
    net = gateway(db)

    await net.handle_message(f"{BASE}/status", b"not json")
    await net.handle_message(
        f"{BASE}/status",
        json.dumps(
            {
                "id": str(uuid.uuid4()),
                "ts": int(time.time()),
                "device_id": "sl-9999",
                "data": {"online": True},
            }
        ).encode(),
    )
    await net.handle_message(f"{BASE}/heartbeat", message({"uptime_s": 10}))

    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    assert device.get("last_seen") is None
    assert await db.access_events.count_documents({}) == 0


async def test_access_decision_is_stored_and_exposed(
    api: AsyncClient, db: Database, operator_headers: dict[str, str]
) -> None:
    await make_device(db)
    event_id = str(uuid.uuid4())
    await gateway(db).handle_message(
        f"{BASE}/events/access-decision",
        message(
            {
                "decision": "denied",
                "reason": "acl_absent",
                "source": "card",
                "uid": "AA:BB:CC:DD",
            },
            message_id=event_id,
        ),
    )

    response = await api.get("/api/v1/access-events", headers=operator_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["decision"] == "denied"
    assert body["items"][0]["reason"] == "acl_absent"
    assert body["items"][0]["degraded"] is False

    filtered = await api.get(
        "/api/v1/access-events?device_id=sl-0002", headers=operator_headers
    )
    assert filtered.json()["total"] == 0


async def test_event_is_degraded_when_rtc_is_invalid(db: Database) -> None:
    await make_device(db)
    net = gateway(db)
    await net.handle_message(
        f"{BASE}/heartbeat",
        message({"uptime_s": 10, "rssi": -60, "rtc_valid": False, "free_heap": 1}),
    )
    await net.handle_message(
        f"{BASE}/events/access-decision",
        message(
            {
                "decision": "unknown",
                "reason": "manual_open",
                "source": "manual",
            },
            ts=1,
        ),
    )

    event = await db.access_events.find_one({})
    assert event is not None
    assert event["degraded"] is True
    assert datetime.now(UTC) - event["ts"] < timedelta(seconds=5)


async def test_activity_requires_authentication(api: AsyncClient) -> None:
    response = await api.get("/api/v1/access-events")
    assert response.status_code == 401


async def test_message_handler_failure_does_not_stop_consumer(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class FailingDevices:
        async def find_one(self, *args: Any, **kwargs: Any) -> None:
            raise PyMongoError("database down")

    class FailingDb:
        devices = FailingDevices()

    net = MqttGateway(
        cast(Database, FailingDb()), Settings(mqtt_url="mqtt://127.0.0.1:1883")
    )
    await net.handle_message(
        f"{BASE}/heartbeat",
        message({"uptime_s": 1, "rssi": -50, "rtc_valid": True}),
    )
    assert "MQTT message handling failed" in caplog.text
