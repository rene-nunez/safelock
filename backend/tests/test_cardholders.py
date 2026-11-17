from typing import Any, cast

from httpx import AsyncClient

from app.db.mongo import Database


async def create_cardholder(
    api: AsyncClient, headers: dict[str, str], **overrides: Any
) -> dict[str, Any]:
    payload = {
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "unit": "Engineering",
        **overrides,
    }
    response = await api.post("/api/v1/cardholders", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


async def test_operator_manages_cardholders(
    api: AsyncClient, operator_headers: dict[str, str]
) -> None:
    created = await create_cardholder(api, operator_headers)

    assert created["name"] == "Ada Lovelace"
    assert created["email"] == "ada@example.com"
    assert created["status"] == "active"

    listed = await api.get("/api/v1/cardholders", headers=operator_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created["id"]]

    updated = await api.patch(
        f"/api/v1/cardholders/{created['id']}",
        headers=operator_headers,
        json={"name": "Ada Byron", "unit": None},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Ada Byron"
    assert updated.json()["unit"] is None


async def test_cardholder_requires_auth(api: AsyncClient) -> None:
    response = await api.get("/api/v1/cardholders")
    assert response.status_code == 401


async def test_unknown_cardholder(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    missing = await api.get(
        "/api/v1/cardholders/000000000000000000000000", headers=admin_headers
    )
    invalid = await api.get("/api/v1/cardholders/not-an-id", headers=admin_headers)

    assert missing.status_code == 404
    assert invalid.status_code == 404


async def test_update_rejects_empty_payload(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    created = await create_cardholder(api, admin_headers)

    response = await api.patch(
        f"/api/v1/cardholders/{created['id']}", headers=admin_headers, json={}
    )

    assert response.status_code == 422


async def test_deactivating_holder_revokes_credentials(
    api: AsyncClient,
    admin_headers: dict[str, str],
    db: Database,
) -> None:
    holder = await create_cardholder(api, admin_headers)
    first = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    second = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "11:22:33:44"},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    response = await api.patch(
        f"/api/v1/cardholders/{holder['id']}",
        headers=admin_headers,
        json={"status": "inactive"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "inactive"

    credentials = await api.get(
        f"/api/v1/cardholders/{holder['id']}/credentials", headers=admin_headers
    )
    assert {item["status"] for item in credentials.json()} == {"revoked"}
    assert await db.audit_logs.count_documents({"action": "credential.revoke_all"}) == 1


async def test_inactive_holder_cannot_receive_credentials(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    await api.patch(
        f"/api/v1/cardholders/{holder['id']}",
        headers=admin_headers,
        json={"status": "inactive"},
    )

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )

    assert response.status_code == 409
