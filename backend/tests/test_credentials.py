from datetime import UTC, datetime, timedelta

from bson import ObjectId
from httpx import AsyncClient

from app.db.mongo import Database
from tests.test_cardholders import create_cardholder


async def test_create_credential_normalizes_uid_and_hashes_pin(
    api: AsyncClient, operator_headers: dict[str, str], db: Database
) -> None:
    holder = await create_cardholder(api, operator_headers)

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=operator_headers,
        json={"uid": "aabbccdd", "pin": "123456"},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["uid"] == "AA:BB:CC:DD"
    assert body["status"] == "active"
    assert body["has_pin"] is True
    assert "pin_hash" not in body

    stored = await db.credentials.find_one({"uid": "AA:BB:CC:DD"})
    assert stored is not None
    assert stored["pin_hash"].startswith("$argon2id$")
    assert "123456" not in stored["pin_hash"]


async def test_create_credential_accepts_seven_byte_uid(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "04:a2:b3:c4:d5:e6:f7"},
    )

    assert response.status_code == 201
    assert response.json()["uid"] == "04:A2:B3:C4:D5:E6:F7"


async def test_invalid_uid_is_rejected(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "not-a-uid"},
    )

    assert response.status_code == 422


async def test_active_uid_must_be_unique_until_revoked(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    first = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    assert first.status_code == 201

    duplicate = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "aa:bb:cc:dd"},
    )
    assert duplicate.status_code == 409

    revoked = await api.post(
        f"/api/v1/credentials/{first.json()['id']}/revoke",
        headers=admin_headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"

    replacement = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    assert replacement.status_code == 201


async def test_revoke_all_credentials(
    api: AsyncClient, operator_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, operator_headers)
    for uid in ("AA:BB:CC:DD", "11:22:33:44"):
        created = await api.post(
            f"/api/v1/cardholders/{holder['id']}/credentials",
            headers=operator_headers,
            json={"uid": uid},
        )
        assert created.status_code == 201

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials/revoke-all",
        headers=operator_headers,
    )

    assert response.status_code == 200
    assert len(response.json()) == 2
    assert {item["status"] for item in response.json()} == {"revoked"}

    again = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials/revoke-all",
        headers=operator_headers,
    )
    assert again.status_code == 200
    assert again.json() == []


async def test_update_pin_resets_failed_attempts(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    holder = await create_cardholder(api, admin_headers)
    created = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD", "pin": "123456"},
    )
    credential_id = created.json()["id"]
    await db.credentials.update_one(
        {"uid": "AA:BB:CC:DD"},
        {"$set": {"pin_fails": 4, "pin_locked_until": datetime.now(UTC)}},
    )

    response = await api.patch(
        f"/api/v1/credentials/{credential_id}",
        headers=admin_headers,
        json={"pin": "654321"},
    )

    assert response.status_code == 200
    stored = await db.credentials.find_one({"uid": "AA:BB:CC:DD"})
    assert stored is not None
    assert stored["pin_fails"] == 0
    assert stored["pin_locked_until"] is None


async def test_clear_pin(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    created = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD", "pin": "123456"},
    )

    response = await api.patch(
        f"/api/v1/credentials/{created.json()['id']}",
        headers=admin_headers,
        json={"clear_pin": True},
    )

    assert response.status_code == 200
    assert response.json()["has_pin"] is False


async def test_validity_window_is_validated(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    now = datetime.now(UTC)

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={
            "uid": "AA:BB:CC:DD",
            "valid_from": (now + timedelta(days=1)).isoformat(),
            "valid_to": now.isoformat(),
        },
    )

    assert response.status_code == 422


async def test_restore_is_admin_only(
    api: AsyncClient,
    admin_headers: dict[str, str],
    operator_headers: dict[str, str],
) -> None:
    holder = await create_cardholder(api, admin_headers)
    created = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    credential_id = created.json()["id"]
    await api.post(
        f"/api/v1/credentials/{credential_id}/revoke", headers=admin_headers
    )

    forbidden = await api.post(
        f"/api/v1/credentials/{credential_id}/restore", headers=operator_headers
    )
    restored = await api.post(
        f"/api/v1/credentials/{credential_id}/restore", headers=admin_headers
    )

    assert forbidden.status_code == 403
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"


async def test_delete_unused_credential(
    api: AsyncClient, operator_headers: dict[str, str], db: Database
) -> None:
    holder = await create_cardholder(api, operator_headers)
    created = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=operator_headers,
        json={"uid": "AA:BB:CC:DD"},
    )

    response = await api.delete(
        f"/api/v1/credentials/{created.json()['id']}", headers=operator_headers
    )

    assert response.status_code == 204
    assert await db.credentials.count_documents({}) == 0
    assert (
        await db.audit_logs.count_documents({"action": "credential.delete"}) == 1
    )


async def test_delete_credential_with_events_is_blocked(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    holder = await create_cardholder(api, admin_headers)
    created = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    await db.access_events.insert_one(
        {
            "device_id": "sl-0001",
            "ts": datetime.now(UTC),
            "uid": "AA:BB:CC:DD",
            "credential_id": ObjectId(created.json()["id"]),
            "decision": "granted",
            "mqtt_id": "event-1",
        }
    )

    response = await api.delete(
        f"/api/v1/credentials/{created.json()['id']}", headers=admin_headers
    )

    assert response.status_code == 409
    assert await db.credentials.count_documents({}) == 1
