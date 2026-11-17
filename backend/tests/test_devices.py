from datetime import UTC, datetime, timedelta
from typing import Any, cast

from httpx import AsyncClient

from app.db.mongo import Database


async def create_device(
    api: AsyncClient, headers: dict[str, str], **overrides: object
) -> dict[str, Any]:
    payload = {
        "device_id": "sl-0001",
        "name": "Front door",
        "site": "HQ",
        "offline_policy": "allow",
        "stale_acl_hours": 72,
        "unlock_ms": 3000,
        "requires_pin": False,
        **overrides,
    }
    response = await api.post("/api/v1/devices", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


async def test_operator_cannot_create_device(
    api: AsyncClient, operator_headers: dict[str, str]
) -> None:
    response = await api.post(
        "/api/v1/devices",
        headers=operator_headers,
        json={"device_id": "sl-0001", "name": "Front door"},
    )

    assert response.status_code == 403


async def test_admin_creates_and_lists_devices(
    api: AsyncClient, admin_headers: dict[str, str], operator_headers: dict[str, str]
) -> None:
    created = await create_device(api, admin_headers)

    assert created["device_id"] == "sl-0001"
    assert created["status"] == "active"
    assert created["locked"] is False
    assert created["online"] is False

    listed = await api.get("/api/v1/devices", headers=operator_headers)
    assert listed.status_code == 200
    assert [item["device_id"] for item in listed.json()] == ["sl-0001"]


async def test_device_id_is_validated(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await api.post(
        "/api/v1/devices",
        headers=admin_headers,
        json={"device_id": "front-door", "name": "Front door"},
    )

    assert response.status_code == 422


async def test_device_id_must_be_unique(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    await create_device(api, admin_headers)

    response = await api.post(
        "/api/v1/devices",
        headers=admin_headers,
        json={"device_id": "SL-0001", "name": "Another door"},
    )

    assert response.status_code == 409


async def test_operator_can_only_toggle_lock(
    api: AsyncClient, admin_headers: dict[str, str], operator_headers: dict[str, str]
) -> None:
    created = await create_device(api, admin_headers)
    device_id = created["id"]

    locked = await api.patch(
        f"/api/v1/devices/{device_id}",
        headers=operator_headers,
        json={"locked": True},
    )
    settings = await api.patch(
        f"/api/v1/devices/{device_id}",
        headers=operator_headers,
        json={"requires_pin": True},
    )

    assert locked.status_code == 200
    assert locked.json()["locked"] is True
    assert settings.status_code == 403


async def test_admin_updates_device_settings(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await create_device(api, admin_headers)

    response = await api.patch(
        f"/api/v1/devices/{created['id']}",
        headers=admin_headers,
        json={
            "name": "Server room",
            "requires_pin": True,
            "offline_policy": "deny",
            "stale_acl_hours": 24,
            "unlock_ms": 5000,
            "location": {"lat": -33.45, "lng": -70.66},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Server room"
    assert body["requires_pin"] is True
    assert body["offline_policy"] == "deny"
    assert body["location"] == {"lat": -33.45, "lng": -70.66}


async def test_online_is_computed_from_last_seen(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    created = await create_device(api, admin_headers)
    device_id = created["id"]

    await db.devices.update_one(
        {"device_id": "sl-0001"}, {"$set": {"last_seen": datetime.now(UTC)}}
    )
    online = await api.get(f"/api/v1/devices/{device_id}", headers=admin_headers)

    await db.devices.update_one(
        {"device_id": "sl-0001"},
        {"$set": {"last_seen": datetime.now(UTC) - timedelta(minutes=5)}},
    )
    offline = await api.get(f"/api/v1/devices/{device_id}", headers=admin_headers)

    assert online.json()["online"] is True
    assert offline.json()["online"] is False


async def test_admin_retires_device(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await create_device(api, admin_headers)

    response = await api.patch(
        f"/api/v1/devices/{created['id']}",
        headers=admin_headers,
        json={"status": "retired"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "retired"


async def test_delete_device_without_history(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    created = await create_device(api, admin_headers)

    response = await api.delete(
        f"/api/v1/devices/{created['id']}", headers=admin_headers
    )

    assert response.status_code == 204
    assert await db.devices.count_documents({}) == 0
    assert await db.audit_logs.count_documents({"action": "device.delete"}) == 1


async def test_delete_device_with_history_is_blocked(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    created = await create_device(api, admin_headers)
    await db.devices.update_one(
        {"device_id": "sl-0001"}, {"$set": {"last_seen": datetime.now(UTC)}}
    )

    response = await api.delete(
        f"/api/v1/devices/{created['id']}", headers=admin_headers
    )

    assert response.status_code == 409
    assert await db.devices.count_documents({}) == 1


async def test_operator_cannot_delete_device(
    api: AsyncClient, admin_headers: dict[str, str], operator_headers: dict[str, str]
) -> None:
    created = await create_device(api, admin_headers)

    response = await api.delete(
        f"/api/v1/devices/{created['id']}", headers=operator_headers
    )

    assert response.status_code == 403
