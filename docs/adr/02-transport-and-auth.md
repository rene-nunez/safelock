# ADR 02: MQTT 3.1.1 over TLS with broker credentials

- **Status:** accepted
- **Date:** 2026-11-16

## Context

We need a simple and secure way for devices and the backend to communicate. The device is an ESP32 using PubSubClient, which supports MQTT 3.1.1.

## Decision

- Use **MQTT 3.1.1** over **TLS (port 8883)** with a fixed CA on the device. Do not use `setInsecure()`.
- Each device signs in with **username = `device_id`** and its MQTT password.
- Do not add message signatures or extra security fields inside the payload. TLS, broker credentials, and topic permissions are enough for this design.
- Use a retained **`status`** message and a **Last Will** (LWT) to know if a device is online.
- Set up device credentials once over **serial/USB** during installation. There is no factory credential and no network provisioning flow.

## Consequences

- Fewer secrets and simpler firmware (no message signing code).
- TLS needs a correct clock: seed from the RTC and sync with network time when possible. If the clock is not valid, do not try TLS.
- Device identity depends on the broker; the backend trusts the broker to identify which `device_id` sent a message.
