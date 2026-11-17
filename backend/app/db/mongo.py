from typing import Any

from pymongo import ASCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.asynchronous.mongo_client import AsyncMongoClient

Document = dict[str, Any]
Database = AsyncDatabase[Document]


def create_client(uri: str, *, timeout_ms: int = 30_000) -> AsyncMongoClient[Document]:
    return AsyncMongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=timeout_ms)


def get_database(client: AsyncMongoClient[Document], name: str) -> Database:
    return client[name]


async def ensure_indexes(db: Database) -> None:
    await db.users.create_indexes(
        [IndexModel([("email", ASCENDING)], unique=True, name="email_unique")]
    )
