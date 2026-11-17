from datetime import UTC, datetime

from httpx import AsyncClient

from app.db.mongo import Database


async def test_operator_cannot_read_audit_logs(
    api: AsyncClient, operator_headers: dict[str, str]
) -> None:
    response = await api.get("/api/v1/audit-logs", headers=operator_headers)

    assert response.status_code == 403


async def test_admin_reads_audit_logs_with_pagination(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    await db.audit_logs.insert_many(
        [
            {
                "actor_id": None,
                "action": f"test.action.{index}",
                "target": f"target-{index}",
                "before": None,
                "after": {"index": index},
                "ip": "127.0.0.1",
                "ts": datetime.now(UTC),
            }
            for index in range(3)
        ]
    )

    first = await api.get(
        "/api/v1/audit-logs?limit=2&offset=0", headers=admin_headers
    )
    second = await api.get(
        "/api/v1/audit-logs?limit=2&offset=2", headers=admin_headers
    )

    assert first.status_code == 200
    assert first.json()["total"] == 3
    assert len(first.json()["items"]) == 2
    assert len(second.json()["items"]) == 1


async def test_filter_audit_logs_by_action(
    api: AsyncClient, admin_headers: dict[str, str], db: Database
) -> None:
    await db.audit_logs.insert_many(
        [
            {
                "actor_id": None,
                "action": "device.create",
                "target": "sl-0001",
                "ts": datetime.now(UTC),
            },
            {
                "actor_id": None,
                "action": "credential.create",
                "target": "AA:BB:CC:DD",
                "ts": datetime.now(UTC),
            },
        ]
    )

    response = await api.get(
        "/api/v1/audit-logs?action=device.create", headers=admin_headers
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["action"] == "device.create"


async def test_api_actions_are_audited(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    await api.post(
        "/api/v1/cardholders",
        headers=admin_headers,
        json={"name": "Ada Lovelace"},
    )

    response = await api.get(
        "/api/v1/audit-logs?action=cardholder.create", headers=admin_headers
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    item = response.json()["items"][0]
    assert item["actor_id"] is not None
    assert item["after"]["name"] == "Ada Lovelace"
