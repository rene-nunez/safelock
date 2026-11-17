from datetime import UTC, datetime

import pytest

from app.db.mongo import Database
from app.services.demo import (
    UnsafeDatabaseError,
    assert_seedable_database,
    reset_demo_data,
    seed_demo_data,
)


def test_seed_database_guard() -> None:
    assert_seedable_database("safelock_dev")
    assert_seedable_database("safelock_test_abc123")

    with pytest.raises(UnsafeDatabaseError):
        assert_seedable_database("safelock")
    with pytest.raises(UnsafeDatabaseError):
        assert_seedable_database("other_database")


async def test_seed_demo_data_is_repeatable(db: Database) -> None:
    await reset_demo_data(db)
    first = await seed_demo_data(db)

    assert first == {
        "cardholders": 3,
        "credentials": 5,
        "devices": 4,
        "audit_logs": 6,
    }
    assert await db.cardholders.count_documents({"seed": "demo"}) == 3
    assert await db.credentials.count_documents({"seed": "demo"}) == 5
    assert await db.devices.count_documents({"seed": "demo"}) == 4
    assert await db.audit_logs.count_documents({"seed": "demo"}) == 6

    pin = await db.credentials.find_one({"uid": "04:A2:B3:C4:D5:E6:F7"})
    assert pin is not None
    assert pin["pin_hash"].startswith("$argon2id$")

    await reset_demo_data(db)
    second = await seed_demo_data(db)
    assert second == first


async def test_reset_keeps_non_demo_data(db: Database) -> None:
    await reset_demo_data(db)
    await db.cardholders.insert_one(
        {
            "name": "Real person",
            "email": "real@example.com",
            "unit": None,
            "status": "active",
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
    )
    await seed_demo_data(db)

    await reset_demo_data(db)

    assert await db.cardholders.count_documents({}) == 1
    assert await db.cardholders.count_documents({"seed": "demo"}) == 0
    assert await db.credentials.count_documents({}) == 0
    assert await db.devices.count_documents({}) == 0
