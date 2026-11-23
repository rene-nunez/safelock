from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from app.db.mongo import Database

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
    return max(1, int((locked_until - now).total_seconds()))


async def check_login_allowed(
    db: Database, email: str, now: datetime | None = None
) -> LoginThrottleResult:
    current = now or datetime.now(UTC)
    doc = await db.login_throttles.find_one({"email": email})
    if doc is None:
        return LoginThrottleResult(allowed=True)

    locked_until = _as_utc(doc.get("locked_until"))
    retry_after = _retry_after(current, locked_until)
    if retry_after:
        return LoginThrottleResult(allowed=False, retry_after=retry_after)
    return LoginThrottleResult(allowed=True)


async def register_login_failure(
    db: Database, email: str, now: datetime | None = None
) -> LoginThrottleResult:
    current = now or datetime.now(UTC)
    doc = await db.login_throttles.find_one({"email": email})
    locked_until = _as_utc(doc.get("locked_until")) if doc else None
    retry_after = _retry_after(current, locked_until)
    if retry_after:
        return LoginThrottleResult(allowed=False, retry_after=retry_after)

    failures = int(doc.get("failures", 0)) + 1 if doc else 1
    updates: dict[str, Any] = {
        "email": email,
        "failures": failures,
        "updated_at": current,
    }
    lock_seconds = _lock_seconds(failures)
    if lock_seconds is not None:
        updates["locked_until"] = current + timedelta(seconds=lock_seconds)
        updates["last_lock_seconds"] = lock_seconds

    await db.login_throttles.update_one(
        {"email": email}, {"$set": updates}, upsert=True
    )
    locked_until = _as_utc(updates.get("locked_until"))
    retry_after = _retry_after(current, locked_until)
    if retry_after:
        return LoginThrottleResult(allowed=False, retry_after=retry_after)
    return LoginThrottleResult(allowed=True)


async def clear_login_failures(db: Database, email: str) -> None:
    await db.login_throttles.delete_one({"email": email})
