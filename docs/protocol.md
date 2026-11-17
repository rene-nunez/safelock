# SafeLock Protocol

This is the contract between the ESP32 devices and the backend. If you change the protocol, update this file, the simulator, the backend, and the firmware together.

## Transport

- MQTT **3.1.1**, **QoS 1** for most messages, **TLS** on port 8883 with a fixed CA on the device. Do not use `setInsecure()`.
- The device keeps a **retained** `status` message and sets a **Last Will** (LWT), so the broker can mark it offline if it disconnects.
- The device signs in to the broker with **username = `device_id`** and its MQTT password. There is no signature inside the message: TLS, broker credentials, and topic permissions provide security.

## Message format

Every topic uses the same envelope:

```json
{
  "id": "<uuid4>",
  "ts": 1761000000,
  "device_id": "sl-0001",
  "data": {}
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique UUID4. The backend ignores a repeated `id`. |
| `ts` | number | Event time in **seconds** (UTC). If the device clock is not valid, the backend uses receive time and marks the event as `degraded`. |
| `device_id` | string | Device ID, like `sl-0001`. Must match the MQTT username. |
| `data` | object | Message content for that topic. |

## Topics

Base path: `safelock/devices/{device_id}`

| Topic | Direction | QoS | Retained | Purpose |
|---|---|---|---|---|
| `.../events/card-scan` | device → backend | 1 | no | Card UID read during enrollment |
| `.../events/pin-entry` | device → backend | 1 | no | PIN entered by the user |
| `.../events/access-decision` | device → backend | 1 | no | Access decision made by the device |
| `.../status` | device → backend | 1 | **yes** | Current device status (also used by LWT) |
| `.../heartbeat` | device → backend | 0 | no | Periodic health message |
| `.../commands/enroll` | backend → device | 1 | no | Start enrollment mode |
| `.../commands/unlock` | backend → device | 1 | no | Open the lock remotely or after PIN check |
| `.../commands/synchronize-access-list` | backend → device | 1 | no | Full configuration and access list snapshot |
| `.../response` | device → backend | 1 | no | Result of a command |

## Messages

### `events/card-scan`
Sent **only** during enrollment, after `commands/enroll`. This scan does **not** open the door.

```json
{ "uid": "AA:BB:CC:DD", "request_id": "<uuid4>" }
```

- `request_id`: the same ID sent in `commands/enroll`.

### `events/pin-entry`
Sent when the user finishes entering a PIN on a door that requires it.

```json
{ "uid": "AA:BB:CC:DD", "pin": "123456", "request_id": "<uuid4>" }
```

- `request_id`: created by the device; the backend sends it back in `commands/unlock` to match the result.

### `events/access-decision`
Sent whenever the device makes an access decision. Also sent for a manual opening (which is not an access decision).

```json
{
  "decision": "granted",
  "reason": "acl_match",
  "source": "card",
  "uid": "AA:BB:CC:DD",
  "credential_id": "<objectid>",
  "acl_version": 42,
  "acl_age_s": 120
}
```

- `decision`: `granted`, `denied`, or `unknown`.
- `reason`: why this result happened (see Values).
- `source`: `card`, `pin`, `remote`, or `manual`.
- `uid` and `credential_id` appear only when a card was used. `credential_id` appears only if the card is in the access list.
- `acl_age_s`: how old the applied access list is, in seconds.

Unknown card (not in the access list): `decision: "denied"`, `reason: "acl_absent"`.

Manual opening (key or lock switch, without powering the coil): the device shows a local alert and sends:

```json
{ "decision": "unknown", "reason": "manual_open", "source": "manual" }
```

`unknown` means no access decision was made, so it has no `uid` or `credential_id`.

### `status`
Retained. The device publishes it on connect and when something important changes. The LWT publishes to the same topic with `online: false`.

```json
{
  "online": true,
  "fw": "0.1.0",
  "acl_version": 42,
  "requires_pin": false,
  "locked": false,
  "lock": "locked"
}
```

- `locked`: remote lockdown. If `true`, the device denies all access.
- `lock`: physical lock state, `locked` or `unlocked`.

### `heartbeat`
Sent every 30–60 seconds, QoS 0.

```json
{ "uptime_s": 1234, "rssi": -58, "rtc_valid": true, "free_heap": 180000 }
```

- `rtc_valid: false` means the device clock is not valid (important problem).

### `commands/enroll`
Starts enrollment mode on the device for `ttl_s` seconds.

```json
{ "request_id": "<uuid4>", "ttl_s": 60, "expires_at": 1761000060 }
```

### `commands/unlock`
Opens the lock.

```json
{ "request_id": "<uuid4>", "duration_ms": 3000, "expires_at": 1761000030 }
```

- `request_id`: used to match the `response`.
- `duration_ms`: how long to power the lock.
- `expires_at`: command expiration time (seconds, UTC).

### `commands/synchronize-access-list`
Full snapshot of device configuration and access list in one message.

```json
{
  "acl_version": 43,
  "requires_pin": false,
  "locked": false,
  "offline_policy": "allow",
  "stale_acl_hours": 72,
  "unlock_ms": 3000,
  "entries": [
    {
      "uid": "AA:BB:CC:DD",
      "credential_id": "<objectid>",
      "holder_id": "<objectid>",
      "status": "active",
      "valid_from": 1761000000,
      "valid_to": null
    }
  ]
}
```

- `entries` is the complete list. If a UID is not there, it is not allowed.
- `requires_pin`, `locked`, `offline_policy`, `stale_acl_hours`, and `unlock_ms` are the device settings in this snapshot.
- `offline_policy`: `allow` or `deny`.
- `valid_from` / `valid_to`: seconds (UTC) or `null`.

The device saves this snapshot atomically: write to a temporary file, then rename it. It never applies a partial snapshot.

### `response`
Result of a command.

```json
{ "request_id": "<uuid4>", "result": "ok", "reason": null }
```

- `result`: `ok`, `error`, or `expired`.
- `reason`: optional detail, for example `acl_write_failed`.

## Values

| Field | Values |
|---|---|
| `decision` | `granted`, `denied`, `unknown` |
| `source` | `card`, `pin`, `remote`, `manual` |
| `reason` | `acl_match`, `acl_absent`, `acl_stale`, `expired`, `not_yet_valid`, `offline_no_pin`, `door_locked`, `pin_ok`, `pin_bad`, `pin_locked`, `no_pin_set`, `rtc_invalid`, `backend_unreachable`, `remote`, `manual_open` |
| `lock` | `locked`, `unlocked` |
| `result` | `ok`, `error`, `expired` |
| `offline_policy` | `allow`, `deny` |

## Rules

### Access and offline behavior
- **Card access** is decided by the device using its local access list. This must work even without the backend.
- **PIN** is checked only by the backend. The device never checks or stores the PIN.
- Doors with `requires_pin` need the backend. If the backend is not available, access is denied (`offline_no_pin`). There is no "card only" fallback for these doors.
- For card-only doors, when the backend is not available the device follows `offline_policy` and `stale_acl_hours`.
- A card not in the access list is denied locally (`acl_absent`) but the event is still sent.
- Manual opening (key or switch): local alert and an `access-decision` event with `decision: "unknown"`, `source: "manual"`, `reason: "manual_open"`. If there is no power, it is not recorded.
- Remote lockdown (`locked: true`): deny all access.
- If the device clock is not valid: do not check date validity and do not try TLS; report it in `heartbeat`.

### Event queue
- `events/*` and `response` are saved on the device and sent again after reconnecting. Retries are safe because the backend ignores repeated `id` values.
- `heartbeat` and `status` are not queued.

### Limits
- `commands/synchronize-access-list` must fit in one message (about 8 KB). If it grows too much, split `entries` into pages.
- Commands are sent only when the device is considered online, include `expires_at`, and are not retried after reconnect. If no `response` arrives, the UI marks it as failed.

### Security
- Use TLS with a fixed CA. Never use `setInsecure()`.
- PIN is checked only on the backend (Argon2id hash, rate limits, temporary lock after repeated failures).
- The device must not store reversible secrets, only its configuration and access list.
- MIFARE Classic card UID can be copied. For stronger security, use cards with encrypted authentication.
