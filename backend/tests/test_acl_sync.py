import json
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient

from app.core.config import Settings
from app.db.mongo import Database
from app.main import app
from app.schemas.cardholders import CardholderCreate
from app.schemas.credentials import CredentialCreate
from app.schemas.devices import DeviceCreate
from app.services import acl_sync
from app.services.cardholders import create_cardholder
from app.services.credentials import create_credential
from app.services.devices import create_device
from app.services.mqtt_gateway import MqttGateway

DEVICE_ID = "sl-0001"


class FakeGateway:
    def __init__(self) -> None:
        self.commands: list[tuple[str, str, dict[str, Any]]] = []

    async def publish_command(
        self, device_id: str, command: str, data: dict[str, Any]
    ) -> bool:
        self.commands.append((device_id, command, data))
        return True


@pytest.fixture
async def fake_gateway(api: AsyncClient) -> AsyncIterator[FakeGateway]:
    gateway = FakeGateway()
    app.state.gateway = gateway
    try:
        yield gateway
    finally:
        app.state.gateway = None


async def make_device(db: Database) -> None:
    await create_device(db, DeviceCreate(device_id=DEVICE_ID, name="Front door"))


def envelope(data: dict[str, Any]) -> bytes:
    return json.dumps(
        {
            "id": str(uuid.uuid4()),
            "ts": int(time.time()),
            "device_id": DEVICE_ID,
            "data": data,
        }
    ).encode()


async def test_snapshot_is_complete_and_versioned_only_on_change(
    db: Database,
) -> None:
    await make_device(db)
    first = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert first is not None
    assert first["acl_version"] == 1
    assert first["entries"] == []
    assert first["offline_policy"] == "allow"
    assert first["stale_acl_hours"] == 72

    unchanged = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert unchanged is not None
    assert unchanged["acl_version"] == 1

    holder = await create_cardholder(db, CardholderCreate(name="Ada"))
    valid_from = datetime(2030, 1, 1, tzinfo=UTC)
    await create_credential(
        db,
        holder["_id"],
        CredentialCreate(uid="AA:BB:CC:DD", valid_from=valid_from),
    )

    updated = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert updated is not None
    assert updated["acl_version"] == 2
    assert len(updated["entries"]) == 1
    entry = updated["entries"][0]
    assert entry["uid"] == "AA:BB:CC:DD"
    assert entry["status"] == "active"
    assert entry["valid_from"] == int(valid_from.timestamp())
    assert entry["valid_to"] is None

    await db.credentials.update_one(
        {"uid": "AA:BB:CC:DD"}, {"$set": {"status": "revoked"}}
    )
    revoked = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert revoked is not None
    assert revoked["acl_version"] == 3
    assert revoked["entries"] == []


async def test_snapshot_uses_configured_unlock_ms(db: Database) -> None:
    await make_device(db)
    first = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert first is not None
    assert first["unlock_ms"] == 3000

    await db.devices.update_one(
        {"device_id": DEVICE_ID}, {"$set": {"unlock_ms": 750}}
    )
    updated = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert updated is not None
    assert updated["acl_version"] == 2
    assert updated["unlock_ms"] == 750


async def test_snapshot_excludes_inactive_holders(db: Database) -> None:
    await make_device(db)
    holder = await create_cardholder(db, CardholderCreate(name="Ada"))
    await create_credential(
        db, holder["_id"], CredentialCreate(uid="AA:BB:CC:DD")
    )
    await db.cardholders.update_one(
        {"_id": holder["_id"]}, {"$set": {"status": "inactive"}}
    )

    snapshot = await acl_sync.build_snapshot(db, DEVICE_ID)
    assert snapshot is not None
    assert snapshot["entries"] == []


async def test_sync_endpoint_is_admin_only_and_requires_online_device(
    api: AsyncClient,
    db: Database,
    admin_headers: dict[str, str],
    operator_headers: dict[str, str],
    fake_gateway: FakeGateway,
) -> None:
    await make_device(db)
    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    path_id = str(device["_id"])
    now = datetime.now(UTC)
    await db.devices.update_one({"device_id": DEVICE_ID}, {"$set": {"last_seen": now}})

    response = await api.post(
        f"/api/v1/devices/{path_id}/synchronize-access-list",
        headers=operator_headers,
    )
    assert response.status_code == 403

    response = await api.post(
        f"/api/v1/devices/{path_id}/synchronize-access-list",
        headers=admin_headers,
    )
    assert response.status_code == 202
    body = response.json()
    assert body["request_id"]
    assert body["acl_version"] >= 1
    assert fake_gateway.commands[0][0] == DEVICE_ID
    assert fake_gateway.commands[0][1] == acl_sync.SYNC_COMMAND
    assert fake_gateway.commands[0][2]["request_id"] == body["request_id"]

    await db.devices.update_one(
        {"device_id": DEVICE_ID},
        {"$set": {"last_seen": now - timedelta(minutes=5)}},
    )
    offline = await api.post(
        f"/api/v1/devices/{path_id}/synchronize-access-list",
        headers=admin_headers,
    )
    assert offline.status_code == 409


async def test_response_marks_sync_only_for_pending_request(
    api: AsyncClient, db: Database, fake_gateway: FakeGateway
) -> None:
    await make_device(db)
    now = datetime.now(UTC)
    await db.devices.update_one({"device_id": DEVICE_ID}, {"$set": {"last_seen": now}})
    snapshot = await acl_sync.publish_snapshot(
        db, cast(MqttGateway, fake_gateway), DEVICE_ID
    )
    request_id = snapshot["request_id"]

    net = MqttGateway(db, Settings(mqtt_url="mqtt://127.0.0.1:1883"))
    await net.handle_message(
        f"safelock/devices/{DEVICE_ID}/response",
        envelope(
            {
                "request_id": str(uuid.uuid4()),
                "result": "ok",
                "reason": None,
            }
        ),
    )
    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    assert device.get("last_sync_at") is None

    await net.handle_message(
        f"safelock/devices/{DEVICE_ID}/response",
        envelope({"request_id": request_id, "result": "ok", "reason": None}),
    )
    device = await db.devices.find_one({"device_id": DEVICE_ID})
    assert device is not None
    assert device["last_sync_at"] is not None
    assert device.get("pending_sync_request_id") is None


async def test_gateway_triggers_sync_when_reported_version_is_old(
    db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    await make_device(db)
    await create_cardholder(db, CardholderCreate(name="Ada"))
    await acl_sync.build_snapshot(db, DEVICE_ID)
    await db.devices.update_one(
        {"device_id": DEVICE_ID}, {"$set": {"last_seen": datetime.now(UTC)}}
    )

    published: list[str] = []

    async def publish_command(
        device_id: str, command: str, data: dict[str, Any]
    ) -> bool:
        published.append(command)
        return True

    net = MqttGateway(db, Settings(mqtt_url="mqtt://127.0.0.1:1883"))
    monkeypatch.setattr(net, "publish_command", publish_command)
    await net.handle_message(
        f"safelock/devices/{DEVICE_ID}/status",
        envelope(
            {
                "online": True,
                "fw": "0.2.0",
                "acl_version": 0,
                "requires_pin": False,
                "locked": False,
                "lock": "locked",
            }
        ),
    )
    assert published == [acl_sync.SYNC_COMMAND]


async def test_offline_change_is_sent_on_reconnect_status(
    db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    await make_device(db)
    holder = await create_cardholder(db, CardholderCreate(name="Ada"))
    await create_credential(
        db, holder["_id"], CredentialCreate(uid="AA:BB:CC:DD")
    )
    await db.devices.update_one(
        {"device_id": DEVICE_ID}, {"$set": {"last_seen": datetime.now(UTC)}}
    )

    published: list[str] = []

    async def publish_command(
        device_id: str, command: str, data: dict[str, Any]
    ) -> bool:
        published.append(command)
        return True

    net = MqttGateway(db, Settings(mqtt_url="mqtt://127.0.0.1:1883"))
    monkeypatch.setattr(net, "publish_command", publish_command)
    await net.handle_message(
        f"safelock/devices/{DEVICE_ID}/status",
        envelope(
            {
                "online": True,
                "fw": "0.2.0",
                "acl_version": 0,
                "requires_pin": False,
                "locked": False,
                "lock": "locked",
            }
        ),
    )
    assert published == [acl_sync.SYNC_COMMAND]


async def test_credential_creation_triggers_sync(
    api: AsyncClient,
    db: Database,
    admin_headers: dict[str, str],
    fake_gateway: FakeGateway,
) -> None:
    await make_device(db)
    await db.devices.update_one(
        {"device_id": DEVICE_ID}, {"$set": {"last_seen": datetime.now(UTC)}}
    )
    holder = await create_cardholder(db, CardholderCreate(name="Ada"))

    response = await api.post(
        f"/api/v1/cardholders/{holder['_id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    assert response.status_code == 201
    assert [command for _, command, _ in fake_gateway.commands] == [
        acl_sync.SYNC_COMMAND
    ]
