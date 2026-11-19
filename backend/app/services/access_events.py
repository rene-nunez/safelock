from typing import Any

from pymongo import DESCENDING

from app.db.mongo import Database

EventDocument = dict[str, Any]


async def list_access_events(
    db: Database,
    *,
    limit: int,
    offset: int,
    device_id: str | None = None,
) -> tuple[list[EventDocument], int]:
    query: dict[str, Any] = {}
    if device_id is not None:
        query["device_id"] = device_id

    total = await db.access_events.count_documents(query)
    cursor = (
        db.access_events.find(query).sort("ts", DESCENDING).skip(offset).limit(limit)
    )
    return [document async for document in cursor], total
