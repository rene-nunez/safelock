from __future__ import annotations

from datetime import datetime
from typing import Any

FAILURE_THRESHOLD = 5
BLOCK_SCHEDULE_SECONDS = [60, 5 * 60, 15 * 60, 30 * 60]


def build_failure_pipeline(
    *,
    failures_field: str,
    locked_until_field: str,
    now: datetime,
    extra_set: dict[str, Any] | None = None,
    threshold: int = FAILURE_THRESHOLD,
    schedule_seconds: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Increment a failure counter and escalate the lock in one atomic update."""
    schedule = schedule_seconds or BLOCK_SCHEDULE_SECONDS
    failures: dict[str, Any] = {
        "$add": [{"$ifNull": [f"${failures_field}", 0]}, 1]
    }
    block_index: dict[str, Any] = {
        "$min": [
            {"$subtract": [{"$floor": {"$divide": [failures, threshold]}}, 1]},
            len(schedule) - 1,
        ]
    }
    lock_seconds: dict[str, Any] = {"$arrayElemAt": [schedule, block_index]}
    should_lock: dict[str, Any] = {
        "$and": [
            {"$gte": [failures, threshold]},
            {"$eq": [{"$mod": [failures, threshold]}, 0]},
        ]
    }
    updates: dict[str, Any] = {
        failures_field: failures,
        "updated_at": now,
        locked_until_field: {
            "$cond": [
                should_lock,
                {"$add": [now, {"$multiply": [lock_seconds, 1000]}]},
                {"$ifNull": [f"${locked_until_field}", None]},
            ]
        },
    }
    if extra_set:
        updates.update(extra_set)
    return [{"$set": updates}]
