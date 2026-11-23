from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient, Response

from app.core.config import Settings
from app.core.security import hash_password
from app.db.mongo import Database
from app.services.login_throttle import register_login_failure
from app.services.users import UserAlreadyExistsError, UserDocument, create_user
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD


async def login(api: AsyncClient, email: str, password: str) -> Response:
    return await api.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


async def test_login_returns_token_and_me(
    api: AsyncClient, admin: UserDocument
) -> None:
    response = await login(api, ADMIN_EMAIL, ADMIN_PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 1800
    assert body["access_token"]

    me = await api.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )

    assert me.status_code == 200
    assert me.json()["id"] == str(admin["_id"])
    assert me.json()["email"] == ADMIN_EMAIL
    assert me.json()["role"] == "admin"
    assert me.json()["active"] is True
    assert me.json()["last_login_at"] is not None


async def test_password_is_hashed_with_argon2id(admin: UserDocument) -> None:
    assert admin["password_hash"].startswith("$argon2id$")
    assert ADMIN_PASSWORD not in admin["password_hash"]


async def test_login_normalizes_email_case(
    api: AsyncClient, admin: UserDocument
) -> None:
    response = await login(api, ADMIN_EMAIL.upper(), ADMIN_PASSWORD)

    assert response.status_code == 200


async def test_login_rejects_wrong_password(
    api: AsyncClient, admin: UserDocument
) -> None:
    response = await login(api, ADMIN_EMAIL, "wrong password")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert response.headers["www-authenticate"] == "Bearer"


async def test_login_rejects_unknown_email(api: AsyncClient) -> None:
    response = await login(api, "nobody@example.com", "whatever")

    assert response.status_code == 401


async def test_login_rejects_inactive_user(
    api: AsyncClient, db: Database, admin: UserDocument
) -> None:
    await db.users.update_one({"_id": admin["_id"]}, {"$set": {"active": False}})

    response = await login(api, ADMIN_EMAIL, ADMIN_PASSWORD)

    assert response.status_code == 401


async def test_me_requires_token(api: AsyncClient) -> None:
    response = await api.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


async def test_me_rejects_invalid_token(api: AsyncClient) -> None:
    response = await api.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert response.status_code == 401


async def test_me_rejects_expired_token(
    api: AsyncClient, admin: UserDocument, test_settings: Settings
) -> None:
    token = jwt.encode(
        {
            "sub": str(admin["_id"]),
            "exp": datetime.now(UTC) - timedelta(seconds=1),
        },
        test_settings.jwt_secret,
        algorithm="HS256",
    )

    response = await api.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401


async def test_me_rejects_deleted_user(
    api: AsyncClient, db: Database, admin: UserDocument
) -> None:
    response = await login(api, ADMIN_EMAIL, ADMIN_PASSWORD)
    token = response.json()["access_token"]

    await db.users.delete_one({"_id": admin["_id"]})

    me = await api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 401


async def test_me_accepts_legacy_user_without_token_version(
    api: AsyncClient, db: Database, test_settings: Settings
) -> None:
    inserted = await db.users.insert_one(
        {
            "email": "legacy@example.com",
            "password_hash": hash_password("legacy password long enough"),
            "role": "admin",
            "active": True,
            "last_login_at": None,
        }
    )
    token = jwt.encode(
        {
            "sub": str(inserted.inserted_id),
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        test_settings.jwt_secret,
        algorithm="HS256",
    )

    me = await api.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 200
    assert me.json()["email"] == "legacy@example.com"


async def test_create_user_rejects_duplicate_email(
    db: Database, admin: UserDocument
) -> None:
    with pytest.raises(UserAlreadyExistsError):
        await create_user(db, ADMIN_EMAIL, ADMIN_PASSWORD)


async def test_login_lockout_is_incremental(
    api: AsyncClient, admin: UserDocument
) -> None:
    for _ in range(4):
        response = await login(api, ADMIN_EMAIL, "wrong password")
        assert response.status_code == 401

    fifth = await login(api, ADMIN_EMAIL, "wrong password")
    assert fifth.status_code == 429
    assert fifth.headers.get("retry-after") == "60"
    assert "Too many login attempts" in fifth.json()["detail"]

    locked = await login(api, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert locked.status_code == 429
    assert locked.headers.get("retry-after") is not None


async def test_login_success_clears_failed_attempts(
    api: AsyncClient, admin: UserDocument
) -> None:
    for _ in range(4):
        response = await login(api, ADMIN_EMAIL, "wrong password")
        assert response.status_code == 401

    ok = await login(api, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert ok.status_code == 200

    for _ in range(4):
        response = await login(api, ADMIN_EMAIL, "wrong password")
        assert response.status_code == 401

    fifth = await login(api, ADMIN_EMAIL, "wrong password")
    assert fifth.status_code == 429


@pytest.mark.parametrize(
    ("failures", "expected_seconds"),
    [(5, 60), (10, 300), (15, 900), (20, 1800), (25, 1800)],
)
async def test_login_lockout_escalates_by_blocks(
    db: Database, failures: int, expected_seconds: int
) -> None:
    email = f"lockout-{failures}@example.com"
    for _ in range(failures):
        result = await register_login_failure(db, email)
    assert not result.allowed

    doc = await db.login_throttles.find_one({"email": email})
    assert doc is not None
    assert doc["failures"] == failures
    locked_for = (doc["locked_until"] - doc["updated_at"]).total_seconds()
    assert locked_for == pytest.approx(expected_seconds, abs=1)
