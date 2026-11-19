#include "MqttTransport.h"

#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>

#include "mqtt_config.h"

MqttTransport::MqttTransport(Settings &settings, Net &net, Clock &clock, Lock &lock)
  : settings(settings),
    net(net),
    clock(clock),
    lock(lock),
    client(espMqttClientTypes::UseInternalTask::YES) {}

String MqttTransport::uuid4() const {
  uint8_t bytes[16];
  for (uint8_t i = 0; i < sizeof(bytes); i++) {
    bytes[i] = static_cast<uint8_t>(esp_random() & 0xFF);
  }
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;

  char output[37];
  snprintf(
    output,
    sizeof(output),
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6],
    bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13],
    bytes[14], bytes[15]
  );
  return String(output);
}

String MqttTransport::status_payload(bool online) {
  JsonDocument document;
  document["id"] = uuid4();
  document["ts"] = net.time_valid() ? static_cast<uint64_t>(time(nullptr)) : 0;
  document["device_id"] = device_id;

  JsonObject data = document["data"].to<JsonObject>();
  data["online"] = online;
  if (online) {
    data["fw"] = MQTT_FW_VERSION;
    data["acl_version"] = 0;
    data["requires_pin"] = false;
    data["locked"] = false;
    data["lock"] = lock.is_closed() ? "locked" : "unlocked";
  }

  String payload;
  serializeJson(document, payload);
  return payload;
}

void MqttTransport::begin() {
  device_id = settings.get_device_id();
  mqtt_password = settings.get_mqtt_password();
  status_topic = "safelock/devices/" + device_id + "/status";
  heartbeat_topic = "safelock/devices/" + device_id + "/heartbeat";
  commands_topic = "safelock/devices/" + device_id + "/commands/#";

  client.setCACert(MQTT_CA_PEM);
  client.setClientId(device_id.c_str());
  client.setCredentials(device_id.c_str(), mqtt_password.c_str());
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setKeepAlive(60);
  client.setCleanSession(true);

  // The library keeps pointers, not copies, so will_payload has to stay alive.
  will_payload = status_payload(false);
  client.setWill(status_topic.c_str(), MQTT_QOS1, true, will_payload.c_str());

  client.onConnect([this](bool session_present) {
    (void)session_present;
    Serial.println("MQTT connected");
    if (client.subscribe(commands_topic.c_str(), MQTT_QOS1) == 0) {
      Serial.println("MQTT subscribe failed");
    }
    publish_status();
    last_heartbeat.store(millis());
  });

  client.onDisconnect([](espMqttClientTypes::DisconnectReason reason) {
    Serial.print("MQTT disconnected, reason ");
    Serial.println(static_cast<uint8_t>(reason));
  });

  client.onMessage([](const espMqttClientTypes::MessageProperties &properties, const char *topic, const uint8_t *payload, size_t len, size_t index, size_t total) {
    (void)properties;
    (void)payload;
    (void)len;
    (void)total;

    // Commands are handled in a later milestone. Never log the payload: it may contain a PIN or a card UID.
    if (index == 0) {
      Serial.print("MQTT command ignored: ");
      Serial.println(topic);
    }
  });
}

void MqttTransport::update() {
  // TLS needs a real clock: without network time the device stays offline.
  if (!net.is_connected() || !net.time_valid()) return;

  if (client.connected()) {
    if (millis() - last_heartbeat.load() >= MQTT_HEARTBEAT_MS) {
      last_heartbeat.store(millis());
      publish_heartbeat();
    }
    return;
  }

  // connect() is asynchronous; do not restart an attempt already in progress.
  if (!client.disconnected()) return;
  if (millis() - last_reconnect < MQTT_RECONNECT_MS) return;
  last_reconnect = millis();

  if (!client.connect()) Serial.println("MQTT connect failed");
}

void MqttTransport::publish_status() {
  const String payload = status_payload(true);
  if (client.publish(status_topic.c_str(), MQTT_QOS1, true, payload.c_str()) == 0) {
    Serial.println("MQTT status publish failed");
  }
}

void MqttTransport::publish_heartbeat() {
  JsonDocument document;
  document["id"] = uuid4();
  document["ts"] = net.time_valid() ? static_cast<uint64_t>(time(nullptr)) : 0;
  document["device_id"] = device_id;

  JsonObject data = document["data"].to<JsonObject>();
  data["uptime_s"] = millis() / 1000;
  data["rssi"] = net.rssi();
  data["rtc_valid"] = clock.is_valid();
  data["free_heap"] = ESP.getFreeHeap();

  String payload;
  serializeJson(document, payload);
  if (client.publish(heartbeat_topic.c_str(), MQTT_QOS0, false, payload.c_str()) == 0) {
    Serial.println("MQTT heartbeat publish failed");
  }
}
