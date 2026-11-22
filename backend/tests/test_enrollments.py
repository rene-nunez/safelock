import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient

from app.db.mongo import Database
from app.schemas.devices import DeviceCreate
from app.services.devices import create_device


async def _make_online_device(db: Database) -> dict[str, Any]:
    doc = await create_device(db, DeviceCreate(device_id="sl-0001", name="Front door"))
    await db.devices.update_one(
        {"_id": doc["_id"]}, {"$set": {"last_seen": datetime.now(UTC)}}
    )
    doc["last_seen"] = datetime.now(UTC)
    return doc


async def _make_cardholder(api: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    r = await api.post("/api/v1/cardholders", headers=headers, json={"name": "Ada"})
    assert r.status_code == 201
    data: dict[str, Any] = r.json()
    return data


async def test_enrollment_create_requires_online_device(
    api: AsyncClient, db: Database, operator_headers: dict[str, str]
) -> None:
    await create_device(db, DeviceCreate(device_id="sl-0001", name="Front door"))
    r = await api.post(
        "/api/v1/enrollments",
        headers=operator_headers,
        json={"device_id": "sl-0001"},
    )
    assert r.status_code == 409


async def test_enrollment_happy_path(
    api: AsyncClient, db: Database, operator_headers: dict[str, str]
) -> None:
    await _make_online_device(db)
    holder = await _make_cardholder(api, operator_headers)

    # no gateway in test app => 503; simulate by inserting pending enrollment directly
    now = datetime.now(UTC)
    request_id = str(uuid.uuid4())
    res = await db.enrollments.insert_one(
        {
            "device_id": "sl-0001",
            "request_id": request_id,
            "requested_by": None,
            "status": "pending",
            "uid": None,
            "scanned_at": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    # simulate scan
    await db.enrollments.update_one(
        {"_id": res.inserted_id},
        {"$set": {"status": "scanned", "uid": "AA:BB:CC:DD", "scanned_at": now}},
    )

    confirm = await api.post(
        f"/api/v1/enrollments/{res.inserted_id}/confirm",
        headers=operator_headers,
        json={"holder_id": holder["id"]},
    )
    assert confirm.status_code == 200, confirm.text
    body = confirm.json()
    assert body["status"] == "confirmed"

    creds = await api.get(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=operator_headers,
    )
    assert creds.status_code == 200
    assert any(c["uid"] == "AA:BB:CC:DD" for c in creds.json())
