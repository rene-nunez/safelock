from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.asynchronous.mongo_client import AsyncMongoClient

Document = dict[str, Any]
Database = AsyncDatabase[Document]


def create_client(uri: str, *, timeout_ms: int = 30_000) -> AsyncMongoClient[Document]:
    return AsyncMongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=timeout_ms)


def get_database(client: AsyncMongoClient[Document], name: str) -> Database:
    return client[name]


ACCESS_EVENT_TTL_SECONDS = 2 * 365 * 24 * 60 * 60
AUDIT_LOG_TTL_SECONDS = 2 * 365 * 24 * 60 * 60
LOGIN_THROTTLE_TTL_SECONDS = 30 * 24 * 60 * 60


async def ensure_indexes(db: Database) -> None:
    await db.users.create_indexes(
        [IndexModel([("email", ASCENDING)], unique=True, name="email_unique")]
    )
    await db.cardholders.create_indexes(
        [
            IndexModel([("email", ASCENDING)], name="email"),
            IndexModel([("name", ASCENDING)], name="name"),
        ]
    )
    await db.devices.create_indexes(
        [
            IndexModel(
                [("device_id", ASCENDING)], unique=True, name="device_id_unique"
            )
        ]
    )
    await db.credentials.create_indexes(
        [
            IndexModel(
                [("uid", ASCENDING)],
                unique=True,
                partialFilterExpression={"status": "active"},
                name="uid_active_unique",
            ),
            IndexModel([("holder_id", ASCENDING)], name="holder_id"),
        ]
    )
    await db.enrollments.create_indexes(
        [IndexModel([("created_at", ASCENDING)], expireAfterSeconds=60, name="ttl")]
    )
    await db.access_events.create_indexes(
        [
            IndexModel(
                [("device_id", ASCENDING), ("ts", DESCENDING)], name="device_ts"
            ),
            IndexModel(
                [("mqtt_id", ASCENDING)], unique=True, name="mqtt_id_unique"
            ),
            IndexModel(
                [("ts", ASCENDING)],
                expireAfterSeconds=ACCESS_EVENT_TTL_SECONDS,
                name="ts_ttl",
            ),
        ]
    )
    await db.audit_logs.create_indexes(
        [
            IndexModel([("ts", DESCENDING)], name="ts"),
            IndexModel(
                [("ts", ASCENDING)],
                expireAfterSeconds=AUDIT_LOG_TTL_SECONDS,
                name="ts_ttl",
            ),
        ]
    )
    await db.login_throttles.create_indexes(
        [
            IndexModel([("email", ASCENDING)], unique=True, name="email_unique"),
            IndexModel(
                [("updated_at", ASCENDING)],
                expireAfterSeconds=LOGIN_THROTTLE_TTL_SECONDS,
                name="updated_at_ttl",
            ),
        ]
    )
