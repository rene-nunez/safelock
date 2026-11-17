from httpx import AsyncClient

from app.db.mongo import Database
from app.services.users import UserDocument
from tests.conftest import (
    ADMIN_EMAIL,
    OPERATOR_EMAIL,
    OPERATOR_PASSWORD,
    login_headers,
)

NEW_EMAIL = "new.operator@example.com"
NEW_PASSWORD = "a long enough password"


async def test_operator_cannot_manage_users(
    api: AsyncClient,
    operator: UserDocument,
    operator_headers: dict[str, str],
) -> None:
    listed = await api.get("/api/v1/users", headers=operator_headers)
    created = await api.post(
        "/api/v1/users",
        headers=operator_headers,
        json={"email": NEW_EMAIL, "password": NEW_PASSWORD},
    )
    updated = await api.patch(
        f"/api/v1/users/{operator['_id']}",
        headers=operator_headers,
        json={"active": False},
    )

    assert listed.status_code == 403
    assert created.status_code == 403
    assert updated.status_code == 403


async def test_admin_lists_users(
    api: AsyncClient,
    admin: UserDocument,
    operator: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.get("/api/v1/users", headers=admin_headers)

    assert response.status_code == 200
    users = response.json()
    assert {user["email"] for user in users} == {ADMIN_EMAIL, OPERATOR_EMAIL}
    assert all("password_hash" not in user for user in users)


async def test_admin_creates_operator(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await api.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"email": NEW_EMAIL, "password": NEW_PASSWORD},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == NEW_EMAIL
    assert body["role"] == "operator"
    assert body["active"] is True

    login = await api.post(
        "/api/v1/auth/login",
        json={"email": NEW_EMAIL, "password": NEW_PASSWORD},
    )
    assert login.status_code == 200


async def test_admin_creates_admin(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await api.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"email": NEW_EMAIL, "password": NEW_PASSWORD, "role": "admin"},
    )

    assert response.status_code == 201
    assert response.json()["role"] == "admin"


async def test_create_user_rejects_duplicate_email(
    api: AsyncClient, admin: UserDocument, admin_headers: dict[str, str]
) -> None:
    response = await api.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"email": ADMIN_EMAIL, "password": NEW_PASSWORD},
    )

    assert response.status_code == 409


async def test_create_user_requires_a_long_password(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await api.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"email": NEW_EMAIL, "password": "short"},
    )

    assert response.status_code == 422


async def test_admin_promotes_operator(
    api: AsyncClient,
    operator: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.patch(
        f"/api/v1/users/{operator['_id']}",
        headers=admin_headers,
        json={"role": "admin"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


async def test_admin_deactivates_operator(
    api: AsyncClient,
    operator: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.patch(
        f"/api/v1/users/{operator['_id']}",
        headers=admin_headers,
        json={"active": False},
    )

    assert response.status_code == 200
    assert response.json()["active"] is False

    login = await api.post(
        "/api/v1/auth/login",
        json={"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD},
    )
    assert login.status_code == 401


async def test_admin_resets_password(
    api: AsyncClient,
    operator: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.patch(
        f"/api/v1/users/{operator['_id']}",
        headers=admin_headers,
        json={"password": NEW_PASSWORD},
    )

    assert response.status_code == 200

    old_login = await api.post(
        "/api/v1/auth/login",
        json={"email": OPERATOR_EMAIL, "password": OPERATOR_PASSWORD},
    )
    new_login = await login_headers(api, OPERATOR_EMAIL, NEW_PASSWORD)

    assert old_login.status_code == 401
    assert new_login["Authorization"].startswith("Bearer ")


async def test_admin_cannot_change_own_role(
    api: AsyncClient,
    admin: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.patch(
        f"/api/v1/users/{admin['_id']}",
        headers=admin_headers,
        json={"role": "operator"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "You cannot change your own role or status"


async def test_admin_cannot_deactivate_self(
    api: AsyncClient,
    admin: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.patch(
        f"/api/v1/users/{admin['_id']}",
        headers=admin_headers,
        json={"active": False},
    )

    assert response.status_code == 400


async def test_update_rejects_empty_payload(
    api: AsyncClient,
    operator: UserDocument,
    admin_headers: dict[str, str],
) -> None:
    response = await api.patch(
        f"/api/v1/users/{operator['_id']}", headers=admin_headers, json={}
    )

    assert response.status_code == 422


async def test_update_unknown_user(
    api: AsyncClient, admin_headers: dict[str, str]
) -> None:
    missing = await api.patch(
        "/api/v1/users/000000000000000000000000",
        headers=admin_headers,
        json={"active": False},
    )
    invalid = await api.patch(
        "/api/v1/users/not-an-id",
        headers=admin_headers,
        json={"active": False},
    )

    assert missing.status_code == 404
    assert invalid.status_code == 404


async def test_create_user_writes_audit(
    api: AsyncClient,
    admin: UserDocument,
    admin_headers: dict[str, str],
    db: Database,
) -> None:
    await api.post(
        "/api/v1/users",
        headers=admin_headers,
        json={"email": NEW_EMAIL, "password": NEW_PASSWORD},
    )

    entry = await db.audit_logs.find_one({"action": "user.create", "target": NEW_EMAIL})

    assert entry is not None
    assert entry["actor_id"] == admin["_id"]
    assert entry["after"] == {"email": NEW_EMAIL, "role": "operator", "active": True}


async def test_update_user_writes_audit(
    api: AsyncClient,
    admin: UserDocument,
    operator: UserDocument,
    admin_headers: dict[str, str],
    db: Database,
) -> None:
    await api.patch(
        f"/api/v1/users/{operator['_id']}",
        headers=admin_headers,
        json={"role": "admin"},
    )

    entry = await db.audit_logs.find_one(
        {"action": "user.update", "target": OPERATOR_EMAIL}
    )

    assert entry is not None
    assert entry["actor_id"] == admin["_id"]
    assert entry["before"] == {"role": "operator", "active": True}
    assert entry["after"] == {"role": "admin", "active": True}
