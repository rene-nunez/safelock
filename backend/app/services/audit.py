from datetime import UTC, datetime
from typing import Any

from bson import ObjectId

from app.db.mongo import Database

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
