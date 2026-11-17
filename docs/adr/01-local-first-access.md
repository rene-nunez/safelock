# ADR 01: Local card decisions, backend PIN checks

- **Status:** accepted
- **Date:** 2026-11-16

## Context

Card access must work even if the network or backend is down. At the same time, the PIN is a second factor and should not be stored on the device, where it could be copied or guessed offline.

## Decision

- **Card access** is decided by the **device** using its local access list and the device clock.
- **PIN** is checked only by the **backend** over TLS. The device never checks or stores the PIN.
- Doors with `requires_pin` need the backend. If the backend is not available, access is denied. There is no "card only" fallback.
- **Revocation** and **remote unlock** are also handled by the backend.

## Consequences

- Card-only doors can open fast even without a network (following `offline_policy` and `stale_acl_hours`).
- Doors that require a PIN need a network connection to open.
- The backend is not in the critical path for card access.
- Enrollment, revocation, and PIN changes do not work offline.
- Cutting the network does not bypass the PIN.
