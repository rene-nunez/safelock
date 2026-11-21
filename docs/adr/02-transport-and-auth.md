# ADR 02: MQTT 3.1.1 over TLS with broker credentials

- **Status:** accepted
- **Date:** 2026-11-16
- **Updated:** 2026-11-18 (firmware client changed to espMqttClient so QoS 1 is available)

## Context

We need a simple and secure way for devices and the backend to communicate. The device is an ESP32; the firmware uses `espMqttClient`, an MQTT 3.1.1 client that supports TLS and all QoS levels with `WiFiClientSecure`.

## Decision

- Use **MQTT 3.1.1** over **TLS (port 8883)** with a fixed CA on the device. Do not use `setInsecure()`.
- Each device signs in with username = `device_id` and its MQTT password.
- Do not add message signatures or extra security fields inside the payload. TLS, broker credentials, and topic permissions are enough for this design.
- Use a retained `status` message and a Last Will (LWT) to know if a device is online.
- Publish `status`, `events/*` and `response` at QoS 1; publish `heartbeat` at QoS 0. Subscribe to `commands/#` at QoS 1. The LWT uses QoS 1 and retain.
- Set up device credentials over serial/USB during installation; they can be corrected over that same link without reflashing. There is no factory credential and no network provisioning flow.

## Consequences

- Fewer secrets and simpler firmware (no message signing code).
- `espMqttClient` does not persist outgoing QoS 1 packets across a reboot. The firmware outbox (planned) has to cover that gap for `events/*`.
- TLS needs a correct clock: seed from the RTC and sync with network time when possible. If the clock is not valid, do not try TLS.
- Device identity depends on the broker; the backend trusts the broker to identify which `device_id` sent a message.
