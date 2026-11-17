from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId

from app.db.mongo import Database
from app.schemas.cardholders import CardholderCreate, CardholderStatus
from app.schemas.credentials import CredentialCreate
from app.schemas.devices import (
    DeviceCreate,
    DeviceLocation,
    DeviceStatus,
    OfflinePolicy,
)
from app.services.cardholders import (
    create_cardholder,
    update_cardholder,
)
from app.services.credentials import (
    create_credential,
    revoke_credential,
)
from app.services.devices import create_device, update_device

DEMO_MARKER = "demo"
DEMO_DATABASE_NAMES = ("safelock_dev", "safelock_test_")
UNSAFE_DATABASE_NAMES = {"safelock"}
DEMO_DEVICE_IDS = ("sl-9001", "sl-9002", "sl-9003", "sl-9004")


class UnsafeDatabaseError(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(
            f"Refusing to seed demo data into {name}; use a development database"
        )


def assert_seedable_database(name: str) -> None:
    if name in UNSAFE_DATABASE_NAMES:
        raise UnsafeDatabaseError(name)
    if not name.startswith(DEMO_DATABASE_NAMES):
        raise UnsafeDatabaseError(name)


async def reset_demo_data(db: Database) -> dict[str, int]:
    holder_ids = [
        document["_id"]
        async for document in db.cardholders.find(
            {"seed": DEMO_MARKER}, {"_id": 1}
        )
    ]
    credentials = await db.credentials.delete_many(
        {
            "$or": [
                {"seed": DEMO_MARKER},
                {"holder_id": {"$in": holder_ids}},
            ]
        }
    )
    cardholders = await db.cardholders.delete_many({"seed": DEMO_MARKER})
    devices = await db.devices.delete_many({"seed": DEMO_MARKER})
    enrollments = await db.enrollments.delete_many(
        {"device_id": {"$in": list(DEMO_DEVICE_IDS)}}
    )
    events = await db.access_events.delete_many(
        {"device_id": {"$in": list(DEMO_DEVICE_IDS)}}
    )
    audits = await db.audit_logs.delete_many({"seed": DEMO_MARKER})
    return {
        "credentials": credentials.deleted_count,
        "cardholders": cardholders.deleted_count,
        "devices": devices.deleted_count,
        "enrollments": enrollments.deleted_count,
        "access_events": events.deleted_count,
        "audit_logs": audits.deleted_count,
    }


async def _mark(db: Database, collection: str, document_id: ObjectId) -> None:
    await db[collection].update_one(
        {"_id": document_id}, {"$set": {"seed": DEMO_MARKER}}
    )


async def _create_holder(
    db: Database,
    *,
    name: str,
    email: str,
    unit: str,
    status: CardholderStatus = "active",
) -> dict[str, Any]:
    holder = await create_cardholder(
        db, CardholderCreate(name=name, email=email, unit=unit)
    )
    await _mark(db, "cardholders", holder["_id"])
    if status != "active":
        holder = await update_cardholder(
            db, holder["_id"], {"status": status}
        ) or holder
    return holder


async def _create_card(
    db: Database,
    holder_id: ObjectId,
    *,
    uid: str,
    pin: str | None = None,
    valid_days: int | None = None,
    revoked: bool = False,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    credential = await create_credential(
        db,
        holder_id,
        CredentialCreate(
            uid=uid,
            pin=pin,
            valid_from=now - timedelta(days=30),
            valid_to=None if valid_days is None else now + timedelta(days=valid_days),
        ),
    )
    await _mark(db, "credentials", credential["_id"])
    if revoked:
        credential = await revoke_credential(db, credential)
        await _mark(db, "credentials", credential["_id"])
    return credential


async def _create_lock(
    db: Database,
    *,
    device_id: str,
    name: str,
    site: str,
    location: DeviceLocation | None,
    offline_policy: OfflinePolicy = "allow",
    stale_acl_hours: int = 72,
    unlock_ms: int = 3000,
    requires_pin: bool = False,
    locked: bool = False,
    status: DeviceStatus = "active",
    last_seen: datetime | None = None,
    acl_version: int = 1,
    synced_hours_ago: int | None = 1,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    device = await create_device(
        db,
        DeviceCreate(
            device_id=device_id,
            name=name,
            site=site,
            location=location,
            offline_policy=offline_policy,
            stale_acl_hours=stale_acl_hours,
            unlock_ms=unlock_ms,
            requires_pin=requires_pin,
        ),
    )
    updated = await update_device(
        db,
        device["_id"],
        {
            "seed": DEMO_MARKER,
            "fw": "0.1.0",
            "last_seen": last_seen,
            "acl_version": acl_version,
            "last_sync_at": (
                None
                if synced_hours_ago is None
                else now - timedelta(hours=synced_hours_ago)
            ),
            "locked": locked,
            "status": status,
        },
    )
    return updated or device


async def seed_demo_data(db: Database) -> dict[str, int]:
    now = datetime.now(UTC)
    santiago = DeviceLocation(lat=-33.4489, lng=-70.6693)

    ada = await _create_holder(
        db,
        name="Ada Lovelace",
        email="ada@demo.safelock.dev",
        unit="Engineering",
    )
    grace = await _create_holder(
        db,
        name="Grace Hopper",
        email="grace@demo.safelock.dev",
        unit="Operations",
    )
    alan = await _create_holder(
        db,
        name="Alan Turing",
        email="alan@demo.safelock.dev",
        unit="Research",
        status="inactive",
    )

    await _create_card(db, ada["_id"], uid="AA:BB:CC:DD", valid_days=180)
    await _create_card(
        db,
        ada["_id"],
        uid="04:A2:B3:C4:D5:E6:F7",
        pin="135790",
        valid_days=90,
    )
    await _create_card(
        db,
        grace["_id"],
        uid="11:22:33:44",
        pin="246810",
        valid_days=365,
    )
    await _create_card(
        db, grace["_id"], uid="55:66:77:88", revoked=True
    )
    await _create_card(db, alan["_id"], uid="99:AA:BB:CC", revoked=True)

    await _create_lock(
        db,
        device_id="sl-9001",
        name="Main entrance",
        site="HQ",
        location=santiago,
        acl_version=3,
        last_seen=now - timedelta(seconds=20),
    )
    await _create_lock(
        db,
        device_id="sl-9002",
        name="Server room",
        site="HQ",
        location=DeviceLocation(lat=-33.4495, lng=-70.6700),
        offline_policy="deny",
        stale_acl_hours=24,
        unlock_ms=5000,
        requires_pin=True,
        acl_version=2,
        last_seen=now - timedelta(seconds=45),
    )
    await _create_lock(
        db,
        device_id="sl-9003",
        name="Warehouse",
        site="Warehouse",
        location=DeviceLocation(lat=-33.5110, lng=-70.6420),
        acl_version=5,
        last_seen=now - timedelta(hours=2),
        synced_hours_ago=3,
    )
    await _create_lock(
        db,
        device_id="sl-9004",
        name="Old gate",
        site="HQ",
        location=None,
        status="retired",
        last_seen=None,
        acl_version=1,
        synced_hours_ago=None,
    )

    audits: list[dict[str, Any]] = [
        {
            "seed": DEMO_MARKER,
            "actor_id": None,
            "action": "cardholder.create",
            "target": str(ada["_id"]),
            "before": None,
            "after": {"name": "Ada Lovelace", "unit": "Engineering"},
            "ip": "127.0.0.1",
            "ts": now - timedelta(hours=3),
        },
        {
            "seed": DEMO_MARKER,
            "actor_id": None,
            "action": "credential.create",
            "target": "AA:BB:CC:DD",
            "before": None,
            "after": {"holder_id": str(ada["_id"]), "has_pin": False},
            "ip": "127.0.0.1",
            "ts": now - timedelta(hours=2, minutes=50),
        },
        {
            "seed": DEMO_MARKER,
            "actor_id": None,
            "action": "credential.create",
            "target": "04:A2:B3:C4:D5:E6:F7",
            "before": None,
            "after": {"holder_id": str(ada["_id"]), "has_pin": True},
            "ip": "127.0.0.1",
            "ts": now - timedelta(hours=2, minutes=45),
        },
        {
            "seed": DEMO_MARKER,
            "actor_id": None,
            "action": "device.create",
            "target": "sl-9001",
            "before": None,
            "after": {"name": "Main entrance", "site": "HQ"},
            "ip": "127.0.0.1",
            "ts": now - timedelta(hours=2),
        },
        {
            "seed": DEMO_MARKER,
            "actor_id": None,
            "action": "device.update",
            "target": "sl-9002",
            "before": {"requires_pin": False},
            "after": {"requires_pin": True},
            "ip": "127.0.0.1",
            "ts": now - timedelta(hours=1, minutes=30),
        },
        {
            "seed": DEMO_MARKER,
            "actor_id": None,
            "action": "credential.revoke",
            "target": "55:66:77:88",
            "before": {"status": "active"},
            "after": {"status": "revoked"},
            "ip": "127.0.0.1",
            "ts": now - timedelta(hours=1),
        },
    ]
    await db.audit_logs.insert_many(audits)

    return {
        "cardholders": 3,
        "credentials": 5,
        "devices": 4,
        "audit_logs": len(audits),
    }
