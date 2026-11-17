# ADR 03: Full snapshot sync with atomic save

- **Status:** accepted
- **Date:** 2026-11-16

## Context

The device must keep its access list in sync with the backend. An update must never leave the device with a broken or half-written access list, even if power is lost during the update.

## Decision

- The backend sends a full snapshot in one message (`commands/synchronize-access-list`): device settings and the complete access list.
- The device saves it atomically: write to a temporary file in LittleFS, then rename it. It never applies a partial snapshot.
- No "tombstones": the snapshot is the source of truth. If a UID is not in the snapshot, it is not allowed.
- No split messages for now. If the snapshot becomes too large, paginate the `entries` list.
- Door settings (`requires_pin`, `locked`, `offline_policy`, `stale_acl_hours`, `unlock_ms`) are included in the same snapshot.

## Consequences

- Revocation is simple: remove the UID from the snapshot.
- No partial state to get out of sync.
- The device always keeps a valid last saved state, even if power is lost during writing.
- Every change sends the full access list again, which is acceptable for the expected size.
