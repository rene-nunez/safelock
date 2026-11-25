# Firmware setup

Before flashing, replace the broker values and the placeholder CA in `include/mqtt_config.h` with the real deployment values. The CA is public; only the broker private key must stay private. `setInsecure()` is never used.

## First boot

Open the serial monitor at 115200 baud and type `help` to see the commands. A new device waits for provisioning before starting WiFi or MQTT. Stage each value, review it with `show`, then commit:

```text
set device-id sl-0001
set wifi "My WiFi" "my-wifi-password"
set mqtt "my-mqtt-password"
show
commit
```

`show` prints the effective settings with passwords masked and marks values that are staged but not saved yet. `commit` validates every field, writes NVS and restarts the device; a bad value writes nothing. The single-line shortcut `provision sl-0001 <wifi_ssid> <wifi_password> <mqtt_password>` still works.

Any field can be corrected later over the same USB cable: stage the new value, `commit` and the device restarts with it. `factory-reset` erases all settings and restarts into the first-boot flow; `reboot` restarts without changes.

Double quotes let a credential contain spaces (but not `"`). WiFi passwords are 8-63 characters, SSIDs 1-32 and MQTT passwords 1-128. The MQTT username is the `device_id`. Alternatively, run `make provision PORT=/dev/ttyUSB0` for a guided flow that validates the values before sending them.

## Runtime

On boot the device loads NVS, starts the RTC, restores `/acl.json` and `/outbox.json` from the microSD, connects to WiFi, syncs the clock with SNTP and then connects to MQTT over TLS. It publishes a retained `status` and a `heartbeat` every 30 s.

If the clock is not valid it does not attempt TLS and card expiry checks are skipped.
The Last Will publishes `online: false` to `status` on an unexpected disconnect.

The RFID reader is checked every 2 s in every state, not only while waiting for a card. A coil pulse or an SD write can reset the MFRC522 and clear its antenna bits; recovery verifies a software antenna-on write and falls back to a hard reset of NRSTPD. `CommandReg` and `TxControlReg` are logged when the reader is unhealthy.

## Access decisions

A card is granted only if its UID is in the local snapshot and passes the RTC validity window. No card is accepted before the first snapshot arrives; there is no local password or master card. The keypad is used for PIN entry; PINs are validated only by the backend and never stored on the device. On doors with `requires_pin`, a matching card starts PIN entry and access is granted only after backend validation; without backend access is denied (`offline_no_pin`).

Each scan produces an `events/access-decision` message, including denials and cards outside the ACL. A manual release detected by the bolt sensor produces `decision: "unknown"`, `source: "manual"`, `reason: "manual_open"`.

## Synchronization and outbox

The backend sends the full snapshot on `commands/synchronize-access-list`. The device validates it, writes `/acl.tmp` and renames it to `/acl.json`, then answers on `response`. A rejected snapshot leaves the previous ACL in place.

The `unlock_ms` value in the snapshot overrides the initial `LOCK_OPEN_MS` from `include/config.h`, which is only a boot default. The manual-open attribution window follows the active duration.

Snapshots are stamped with the network epoch even when the RTC is degraded. A restored snapshot without a usable timestamp is reported as `acl_version: 0` in `status` so the backend resends it. Validity windows and `acl_stale` are still evaluated only while the RTC is valid; command expiry uses the network epoch.

Every `events/*` and `response` message is queued in `/outbox.json` and resent when the broker is reachable. The broker deduplicates by message `id`, so a reboot can safely replay in-flight messages. `status` and `heartbeat` are never queued.

The firmware uses `espMqttClient`, which supports MQTT 3.1.1 with TLS and QoS 1. `status` and the LWT are retained at QoS 1, `heartbeat` is QoS 0, and `events/*` and `response` are published at QoS 1. The library does not persist QoS 1 packets across a reboot, so the local outbox covers that gap.
