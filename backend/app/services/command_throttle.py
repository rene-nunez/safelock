from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument

from app.db.mongo import Database


@dataclass(frozen=True)
class CommandThrottleResult:
    allowed: bool
    retry_after: int = 0


def _as_utc(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def _retry_after(now: datetime, until: datetime | None) -> int:
    if until is None or until <= now:
        return 0
    return max(1, math.ceil((until - now).total_seconds()))


async def claim_device_cooldown(
    db: Database,
    *,
    device_id: str,
    field: str,
    cooldown_s: int,
    now: datetime | None = None,
) -> CommandThrottleResult:
    """Atomically reserve the command window before publishing anything."""
    current = now or datetime.now(UTC)
    reserved = await db.devices.find_one_and_update(
        {
            "device_id": device_id,
            "$or": [
                {field: None},
                {field: {"$exists": False}},
                {field: {"$lte": current}},
            ],
        },
        {
            "$set": {
                field: current + timedelta(seconds=cooldown_s),
                "updated_at": current,
            }
        },
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is not None:
        return CommandThrottleResult(allowed=True)

    doc = await db.devices.find_one({"device_id": device_id}, {field: 1})
    if doc is None:
        return CommandThrottleResult(allowed=True)
    return CommandThrottleResult(
        allowed=False, retry_after=_retry_after(current, _as_utc(doc.get(field)))
    )


async def release_device_cooldown(
    db: Database,
    *,
    device_id: str,
    field: str,
    now: datetime | None = None,
) -> None:
    """Give the window back when the command could not be published."""
    current = now or datetime.now(UTC)
    await db.devices.update_one(
        {"device_id": device_id},
        {"$set": {field: None, "updated_at": current}},
    )
