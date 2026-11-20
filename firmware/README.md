# Firmware setup

Before flashing, replace the broker values and the placeholder CA in `include/mqtt_config.h` with the real deployment values. The CA is public; only the broker private key must stay private. `setInsecure()` is never used.

## First boot

Open the serial monitor at 115200 baud and send one line:

```shell
provision sl-0001 <wifi_ssid> <wifi_password> <mqtt_password>
```

Use double quotes around an argument that contains spaces. The device stores the values in NVS and does not echo them back. `factory-reset` clears them so the device can be provisioned again.

## Runtime

On boot the device loads NVS, starts the RTC, restores `/acl.json` and `/outbox.json` from the microSD, connects to WiFi, syncs the clock with SNTP and then connects to MQTT over TLS. It publishes a retained `status` and a `heartbeat` every 30 s.

If the clock is not valid it does not attempt TLS and card expiry checks are skipped.
The Last Will publishes `online: false` to `status` on an unexpected disconnect.

## Access decisions

A card is granted only if its UID is in the local snapshot and passes the RTC validity window. No card is accepted before the first snapshot arrives; there is no local password or master card. The keypad is read but not validated locally: PIN validation is done by the backend in a later milestone. A door with `requires_pin` denies every card.

Each scan produces an `events/access-decision` message, including denials and cards outside the ACL. A manual release detected by the bolt sensor produces `decision: "unknown"`, `source: "manual"`, `reason: "manual_open"`.

## Synchronization and outbox

The backend sends the full snapshot on `commands/synchronize-access-list`. The device validates it, writes `/acl.tmp` and renames it to `/acl.json`, then answers on `response`. A rejected snapshot leaves the previous ACL in place.

Every `events/*` and `response` message is queued in `/outbox.json` and resent when the broker is reachable. The broker deduplicates by message `id`, so a reboot can safely replay in-flight messages. `status` and `heartbeat` are never queued.

The firmware uses `espMqttClient`, which supports MQTT 3.1.1 with TLS and QoS 1. `status` and the LWT are retained at QoS 1, `heartbeat` is QoS 0, and `events/*` and `response` are published at QoS 1. The library does not persist QoS 1 packets across a reboot, so the local outbox covers that gap.
