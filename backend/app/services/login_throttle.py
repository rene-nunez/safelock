from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import ReturnDocument

from app.db.mongo import Database
from app.services.lockout import build_failure_pipeline

THRESHOLD = 5
BLOCK_SCHEDULE_SECONDS = [60, 5 * 60, 15 * 60, 30 * 60]


@dataclass(frozen=True)
class LoginThrottleResult:
    allowed: bool
    retry_after: int = 0


def _as_utc(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def _lock_seconds(failures: int) -> int | None:
    if failures < THRESHOLD or failures % THRESHOLD != 0:
        return None
    block_index = failures // THRESHOLD - 1
    index = min(block_index, len(BLOCK_SCHEDULE_SECONDS) - 1)
    return int(BLOCK_SCHEDULE_SECONDS[index])


def _retry_after(now: datetime, locked_until: datetime | None) -> int:
    if locked_until is None or locked_until <= now:
        return 0
    return max(1, math.ceil((locked_until - now).total_seconds()))


async def check_login_allowed(
    db: Database, email: str, now: datetime | None = None
) -> LoginThrottleResult:
    current = now or datetime.now(UTC)
    doc = await db.login_throttles.find_one({"email": email})
    if doc is None:
        return LoginThrottleResult(allowed=True)

    retry_after = _retry_after(current, _as_utc(doc.get("locked_until")))
    return LoginThrottleResult(allowed=not retry_after, retry_after=retry_after)


async def register_login_failure(
    db: Database, email: str, now: datetime | None = None
) -> LoginThrottleResult:
    current = now or datetime.now(UTC)
    doc = await db.login_throttles.find_one_and_update(
        {"email": email},
        build_failure_pipeline(
            failures_field="failures",
            locked_until_field="locked_until",
            now=current,
            extra_set={"email": email},
            threshold=THRESHOLD,
            schedule_seconds=BLOCK_SCHEDULE_SECONDS,
        ),
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    locked_until = _as_utc(doc.get("locked_until")) if doc else None
    retry_after = _retry_after(current, locked_until)
    return LoginThrottleResult(allowed=not retry_after, retry_after=retry_after)


async def clear_login_failures(db: Database, email: str) -> None:
    await db.login_throttles.delete_one({"email": email})
