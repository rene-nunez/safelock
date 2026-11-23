from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

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
    return max(1, int((until - now).total_seconds()))


async def check_device_cooldown(
    db: Database,
    *,
    device_id: str,
    field: str,
    cooldown_s: int,
    now: datetime | None = None,
) -> CommandThrottleResult:
    current = now or datetime.now(UTC)
    doc = await db.devices.find_one({"device_id": device_id}, {field: 1})
    if doc is None:
        return CommandThrottleResult(allowed=True)
    retry_after = _retry_after(current, _as_utc(doc.get(field)))
    if retry_after:
        return CommandThrottleResult(allowed=False, retry_after=retry_after)
    return CommandThrottleResult(allowed=True)


async def mark_device_cooldown(
    db: Database,
    *,
    device_id: str,
    field: str,
    cooldown_s: int,
    now: datetime | None = None,
) -> None:
    current = now or datetime.now(UTC)
    await db.devices.update_one(
        {"device_id": device_id},
        {
            "$set": {
                field: current + timedelta(seconds=cooldown_s),
                "updated_at": current,
            }
        },
    )
