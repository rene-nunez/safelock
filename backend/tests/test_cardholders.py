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


async def test_admin_deletes_cardholder_without_credentials(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    holder = await create_cardholder(api, admin_headers)

    response = await api.delete(
        f"/api/v1/cardholders/{holder['id']}", headers=admin_headers
    )

    assert response.status_code == 204
    missing = await api.get(
        f"/api/v1/cardholders/{holder['id']}", headers=admin_headers
    )
    assert missing.status_code == 404
    assert await db.audit_logs.count_documents({"action": "cardholder.delete"}) == 1


async def test_delete_cardholder_with_credentials_conflicts(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    created = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    assert created.status_code == 201

    response = await api.delete(
        f"/api/v1/cardholders/{holder['id']}", headers=admin_headers
    )

    assert response.status_code == 409
    still_there = await api.get(
        f"/api/v1/cardholders/{holder['id']}", headers=admin_headers
    )
    assert still_there.status_code == 200


async def test_operator_cannot_delete_cardholder(
    api: AsyncClient, operator_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, operator_headers)

    response = await api.delete(
        f"/api/v1/cardholders/{holder['id']}", headers=operator_headers
    )

    assert response.status_code == 403


async def test_activate_and_restore_cardholder(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    holder = await create_cardholder(api, admin_headers)
    for uid in ("AA:BB:CC:DD", "11:22:33:44"):
        created = await api.post(
            f"/api/v1/cardholders/{holder['id']}/credentials",
            headers=admin_headers,
            json={"uid": uid},
        )
        assert created.status_code == 201
    await api.patch(
        f"/api/v1/cardholders/{holder['id']}",
        headers=admin_headers,
        json={"status": "inactive"},
    )

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/activate-and-restore",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    credentials = await api.get(
        f"/api/v1/cardholders/{holder['id']}/credentials", headers=admin_headers
    )
    assert {item["status"] for item in credentials.json()} == {"active"}
    assert (
        await db.audit_logs.count_documents(
            {
                "action": "credential.restore",
                "after.reason": "cardholder_activation",
            }
        )
        == 2
    )


async def test_activate_and_restore_keeps_manual_revocations(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    manual = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    deactivated = await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "11:22:33:44"},
    )
    assert deactivated.status_code == 201
    await api.post(
        f"/api/v1/credentials/{manual.json()['id']}/revoke", headers=admin_headers
    )
    await api.patch(
        f"/api/v1/cardholders/{holder['id']}",
        headers=admin_headers,
        json={"status": "inactive"},
    )

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/activate-and-restore",
        headers=admin_headers,
    )

    assert response.status_code == 200
    credentials = await api.get(
        f"/api/v1/cardholders/{holder['id']}/credentials", headers=admin_headers
    )
    by_uid = {item["uid"]: item["status"] for item in credentials.json()}
    assert by_uid["AA:BB:CC:DD"] == "revoked"
    assert by_uid["11:22:33:44"] == "active"


async def test_activate_and_restore_is_admin_only(
    api: AsyncClient,
    admin_headers: dict[str, str],
    operator_headers: dict[str, str],
) -> None:
    holder = await create_cardholder(api, admin_headers)
    await api.patch(
        f"/api/v1/cardholders/{holder['id']}",
        headers=admin_headers,
        json={"status": "inactive"},
    )

    forbidden = await api.post(
        f"/api/v1/cardholders/{holder['id']}/activate-and-restore",
        headers=operator_headers,
    )
    allowed = await api.post(
        f"/api/v1/cardholders/{holder['id']}/activate-and-restore",
        headers=admin_headers,
    )

    assert forbidden.status_code == 403
    assert allowed.status_code == 200


async def test_activate_and_restore_conflicting_uid_is_blocked(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    holder = await create_cardholder(api, admin_headers)
    await api.post(
        f"/api/v1/cardholders/{holder['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    await api.patch(
        f"/api/v1/cardholders/{holder['id']}",
        headers=admin_headers,
        json={"status": "inactive"},
    )
    other = await create_cardholder(api, admin_headers, email="grace@example.com")
    replacement = await api.post(
        f"/api/v1/cardholders/{other['id']}/credentials",
        headers=admin_headers,
        json={"uid": "AA:BB:CC:DD"},
    )
    assert replacement.status_code == 201

    response = await api.post(
        f"/api/v1/cardholders/{holder['id']}/activate-and-restore",
        headers=admin_headers,
    )

    assert response.status_code == 409
    current = await api.get(
        f"/api/v1/cardholders/{holder['id']}", headers=admin_headers
    )
    assert current.json()["status"] == "inactive"


async def test_cardholder_listing_is_paginated(
    api: AsyncClient, operator_headers: dict[str, str]
) -> None:
    for name in ("Ada", "Bob", "Cleo"):
        await create_cardholder(
            api, operator_headers, name=name, email=f"{name.lower()}@example.com"
        )

    page = await api.get(
        "/api/v1/cardholders",
        headers=operator_headers,
        params={"limit": 2, "offset": 1},
    )
    assert page.status_code == 200
    assert [item["name"] for item in page.json()] == ["Bob", "Cleo"]

    too_large = await api.get(
        "/api/v1/cardholders", headers=operator_headers, params={"limit": 101}
    )
    assert too_large.status_code == 422
