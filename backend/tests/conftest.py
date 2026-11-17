import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from pymongo.errors import PyMongoError

from app.api.deps import get_db
from app.core.config import Settings, get_settings
from app.db.mongo import Database, create_client, ensure_indexes, get_database
from app.main import app
from app.services.users import UserDocument, create_user

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "correct horse battery"


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        jwt_secret="test-secret-" + "x" * 40,
        access_token_ttl_minutes=30,
    )


@pytest.fixture
async def db(test_settings: Settings) -> AsyncIterator[Database]:
    client = create_client(test_settings.mongodb_uri, timeout_ms=1_500)
    name = f"safelock_test_{uuid.uuid4().hex}"
    database = get_database(client, name)

    try:
        await client.admin.command("ping")
    except PyMongoError:
        await client.close()
        pytest.skip("MongoDB is not available")

    await ensure_indexes(database)
    try:
        yield database
    finally:
        await client.drop_database(name)
        await client.close()


@pytest.fixture
async def api(db: Database, test_settings: Settings) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: test_settings
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
async def admin(db: Database) -> UserDocument:
    return await create_user(db, ADMIN_EMAIL, ADMIN_PASSWORD, "admin")
