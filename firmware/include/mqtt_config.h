#pragma once

// MQTT broker settings. Replace the host and the CA below with the real deployment values before flashing.
// The CA is public: only the broker private key must stay private. Never replace this with setInsecure().

#define MQTT_HOST         "mqtt.example.com"
#define MQTT_PORT         8883
#define MQTT_FW_VERSION   "0.1.0"
#define MQTT_QOS0         0
#define MQTT_QOS1         1
#define MQTT_HEARTBEAT_MS 30000
#define MQTT_RECONNECT_MS 5000

#define MQTT_CA_PEM \
  "-----BEGIN CERTIFICATE-----\n" \
  "REPLACE_WITH_BROKER_CA_CERTIFICATE\n" \
  "-----END CERTIFICATE-----\n"
