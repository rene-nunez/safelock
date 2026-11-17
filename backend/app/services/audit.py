from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from app.db.mongo import Database

AuditDocument = dict[str, Any]
AuditValue = dict[str, Any]


async def record_audit(
    db: Database,
    *,
    actor_id: ObjectId | None,
    action: str,
    target: str,
    before: AuditValue | None = None,
    after: AuditValue | None = None,
    ip: str | None = None,
) -> None:
    await db.audit_logs.insert_one(
        {
            "actor_id": actor_id,
            "action": action,
            "target": target,
            "before": before,
            "after": after,
            "ip": ip,
            "ts": datetime.now(UTC),
        }
    )


async def list_audit_logs(
    db: Database,
    *,
    limit: int,
    offset: int,
    action: str | None = None,
) -> tuple[list[AuditDocument], int]:
    query: dict[str, Any] = {}
    if action:
        query["action"] = action

    cursor = (
        db.audit_logs.find(query)
        .sort([("ts", DESCENDING), ("_id", ASCENDING)])
        .skip(offset)
        .limit(limit)
    )
    documents = [document async for document in cursor]
    total = await db.audit_logs.count_documents(query)
    return documents, total
