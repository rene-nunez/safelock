# Firmware Setup

Before flashing, replace the broker values and the placeholder CA in `include/mqtt_config.h` with the real deployment values. The CA is public; only the broker private key must stay private. `setInsecure()` is never used.

## First Boot

Open the serial monitor at 115200 baud and send one line:

```shell
provision sl-0001 <wifi_ssid> <wifi_password> <mqtt_password>
```

Use double quotes around an argument that contains spaces. The device stores the values in NVS and does not echo them back. `factory-reset` clears them so the device can be provisioned again.

## Runtime

On boot the device loads NVS, starts the RTC, connects to WiFi, syncs the clock with SNTP and then connects to MQTT over TLS. It publishes a retained `status` and a `heartbeat` every 30 s.

If the clock is not valid it does not attempt TLS.
The Last Will publishes `online: false` to `status` on an unexpected disconnect.

The firmware uses `espMqttClient`, which supports MQTT 3.1.1 with TLS and QoS 1. `status` and the LWT are retained at QoS 1, `heartbeat` is QoS 0, and `events/*` and `response` will be published at QoS 1. Outgoing QoS 1 packets are not persisted by the library across a reboot; the local outbox will handle that.
