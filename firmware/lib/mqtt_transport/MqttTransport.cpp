#include "MqttTransport.h"

#include <esp_system.h>
#include <time.h>

#include "mqtt_config.h"

namespace {

constexpr size_t MAX_COMMAND_SIZE = 4096;
constexpr uint16_t MQTT_TCP_TIMEOUT_S = 10;
constexpr uint16_t MQTT_TLS_HANDSHAKE_TIMEOUT_S = 15;

String command_suffix(const char *topic) {
  const char *marker = "/commands/";
  const char *position = strstr(topic, marker);
  if (position == nullptr) return "";
  return String(position + strlen(marker));
}

} // namespace

MqttTransport::MqttTransport(
  Settings &settings,
  Net &net,
  Clock &clock,
  Lock &lock,
  Acl &acl,
  Outbox &outbox
)
  : settings(settings),
    net(net),
    clock(clock),
    lock(lock),
    acl(acl),
    outbox(outbox),
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
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x%02x",
    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6],
    bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13],
    bytes[14], bytes[15]
  );
  return String(output);
}

String MqttTransport::envelope(const JsonObject &data) const {
  JsonDocument document;
  document["id"] = uuid4();
  document["ts"] = clock.is_valid() ? static_cast<uint64_t>(time(nullptr)) : 0;
  document["device_id"] = device_id;

  JsonObject target = document["data"].to<JsonObject>();
  for (JsonPair pair : data) {
    target[pair.key()] = pair.value();
  }

  String payload;
  serializeJson(document, payload);
  return payload;
}

String MqttTransport::status_payload(bool online) {
  JsonDocument document;
  JsonObject data = document["data"].to<JsonObject>();
  data["online"] = online;
  if (online) {
    data["fw"] = MQTT_FW_VERSION;
    // Report 0 when the snapshot has no usable timestamp so the backend resends it.
    data["acl_version"] = acl.has_received_at() ? acl.get_version() : 0;
    data["requires_pin"] = acl.get_requires_pin();
    data["locked"] = acl.get_locked();
    data["lock"] = lock.is_closed() ? "locked" : "unlocked";
  }

  return envelope(data);
}

void MqttTransport::set_command_handler(MqttCommandHandler &handler) {
  command_handler = &handler;
}

void MqttTransport::begin() {
  device_id = settings.get_device_id();
  mqtt_password = settings.get_mqtt_password();
  status_topic = "safelock/devices/" + device_id + "/status";
  event_topic_prefix = "safelock/devices/" + device_id + "/";
  heartbeat_topic = event_topic_prefix + "heartbeat";
  commands_topic = event_topic_prefix + "commands/#";
  response_topic = event_topic_prefix + "response";

  client.setCACert(MQTT_CA_PEM);
  client.setClientId(device_id.c_str());
  client.setCredentials(device_id.c_str(), mqtt_password.c_str());
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setKeepAlive(60);
  client.setCleanSession(true);
  client.set_timeouts(MQTT_TCP_TIMEOUT_S, MQTT_TLS_HANDSHAKE_TIMEOUT_S);

  // The library keeps pointers, not copies, so these strings have to stay alive.
  will_payload = status_payload(false);
  client.setWill(status_topic.c_str(), MQTT_QOS1, true, will_payload.c_str());

  client.onConnect([this](bool session_present) {
    (void)session_present;
    Serial.printf("MQTT connected (uptime=%lu s)\n", millis() / 1000);
    reset_in_flight_pending.store(true);

    if (client.subscribe(commands_topic.c_str(), MQTT_QOS1) == 0) {
      Serial.println("MQTT subscribe failed");
    }
    publish_status();
    last_flush = 0;
    last_heartbeat.store(millis());
  });

  client.onDisconnect([this](espMqttClientTypes::DisconnectReason reason) {
    Serial.print("MQTT disconnected: ");
    Serial.println(espMqttClientTypes::disconnectReasonToString(reason));
    reset_in_flight_pending.store(true);
    command_buffer = "";
    command_expected = 0;
  });

  client.onMessage([this](
    const espMqttClientTypes::MessageProperties &properties,
    const char *topic,
    const uint8_t *payload,
    size_t len,
    size_t index,
    size_t total
  ) {
    (void)properties;

    if (total == 0 || total > MAX_COMMAND_SIZE) {
      command_buffer = "";
      command_expected = 0;
      return;
    }
    if (index == 0) {
      command_buffer = "";
      command_expected = total;
    }
    if (total != command_expected) return;

    command_buffer.concat(reinterpret_cast<const char *>(payload), len);
    if (index + len < total) return;

    handle_command_payload(topic, reinterpret_cast<const uint8_t *>(command_buffer.c_str()), command_buffer.length());
    command_buffer = "";
    command_expected = 0;
  });

  // Only PUBACK/PUBCOMP tokens arrive here; never log the acknowledged payload.
  client.onPublish([this](uint16_t packet_id) {
    std::lock_guard<std::mutex> guard(acks_mutex);
    pending_acks.push_back(packet_id);
  });
}

void MqttTransport::drain_acks() {
  std::vector<uint16_t> acks;
  {
    std::lock_guard<std::mutex> guard(acks_mutex);
    acks.swap(pending_acks);
  }
  for (uint16_t token : acks) {
    outbox.confirm_publish(token);
  }
}

void MqttTransport::update() {
  // TLS needs a real clock: without network time the device stays offline.
  if (!net.is_connected() || !net.time_valid()) return;

  drain_acks();

  if (reset_in_flight_pending.exchange(false)) {
    outbox.reset_in_flight();
    last_flush = 0;
  }

  if (client.connected()) {
    if ((millis() - last_flush) >= 1000) {
      last_flush = millis();
      outbox.flush(*this);
    }

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

  Serial.printf(
    "MQTT connecting (wifi=%d, time=%d, outbox=%u)\n",
    net.is_connected() ? 1 : 0,
    net.time_valid() ? 1 : 0,
    static_cast<unsigned>(outbox.size())
  );
  if (!client.connect()) Serial.println("MQTT connect failed");
}

bool MqttTransport::connected() const {
  return client.connected();
}

uint16_t MqttTransport::publish_queued(
  const char *topic, const String &payload, uint8_t qos
) {
  if (!client.connected()) return 0;
  return client.publish(topic, qos, false, payload.c_str());
}

bool MqttTransport::publish_event(
  const char *suffix, const JsonObject &data, uint8_t qos
) {
  return outbox.enqueue(event_topic_prefix + suffix, envelope(data), qos);
}

bool MqttTransport::publish_response(
  const String &request_id, const char *result, const char *reason
) {
  JsonDocument document;
  JsonObject data = document["data"].to<JsonObject>();
  data["request_id"] = request_id;
  data["result"] = result;
  if (reason != nullptr) data["reason"] = reason;

  return outbox.enqueue(response_topic, envelope(data), MQTT_QOS1);
}

void MqttTransport::handle_command_payload(
  const char *topic, const uint8_t *payload, size_t len
) {
  JsonDocument document;
  if (deserializeJson(document, payload, len) != DeserializationError::Ok) {
    Serial.println("MQTT command: invalid JSON");
    return;
  }

  const JsonObject envelope = document.as<JsonObject>();
  const JsonObject data = envelope["data"].as<JsonObject>();
  const String request_id = data["request_id"] | "";
  if (request_id.length() == 0) {
    Serial.println("MQTT command without request_id");
    return;
  }

  const int expires_at = data["expires_at"] | 0;
  const time_t now = time(nullptr);
  if (now > 0 && expires_at > 0 && now > expires_at) {
    publish_response(request_id, "expired", "command_expired");
    return;
  }

  handle_command(command_suffix(topic), data);
}

void MqttTransport::handle_command(const String &command, const JsonObject &data) {
  Serial.print("MQTT command: ");
  Serial.println(command);

  const String request_id = data["request_id"] | "";
  if (command == "synchronize-access-list") {
    const bool applied = acl.apply(data, time(nullptr));
    if (!applied) {
      publish_response(request_id, "error", "invalid_snapshot");
      return;
    }

    lock.set_unlock_ms(acl.get_unlock_ms());
    publish_response(request_id, "ok", nullptr);
    publish_status();
    return;
  }

  if (command == "unlock") {
    if (command_handler == nullptr) {
      publish_response(request_id, "error", "not_ready");
      return;
    }
    uint16_t duration_ms = data["duration_ms"] | acl.get_unlock_ms();
    if (duration_ms < 100) duration_ms = 100;
    if (duration_ms > 10000) duration_ms = 10000;
    command_handler->handle_remote_unlock(duration_ms);
    publish_response(request_id, "ok", nullptr);
    publish_status();
    return;
  }

  if (command == "enroll") {
    if (command_handler == nullptr) {
      publish_response(request_id, "error", "not_ready");
      return;
    }
    const uint32_t ttl_s = data["ttl_s"] | 60;
    if (command_handler->begin_enrollment(request_id, ttl_s)) {
      publish_response(request_id, "ok", nullptr);
    } else {
      publish_response(request_id, "error", "busy");
    }
    return;
  }

  publish_response(request_id, "error", "unsupported_command");
}

void MqttTransport::publish_status() {
  const String payload = status_payload(true);
  if (client.publish(status_topic.c_str(), MQTT_QOS1, true, payload.c_str()) == 0) {
    Serial.println("MQTT status publish failed");
  }
}

void MqttTransport::publish_heartbeat() {
  JsonDocument document;
  JsonObject data = document["data"].to<JsonObject>();
  data["uptime_s"] = millis() / 1000;
  data["rssi"] = net.rssi();
  data["rtc_valid"] = clock.is_valid();
  data["free_heap"] = ESP.getFreeHeap();

  const String payload = envelope(data);
  if (client.publish(heartbeat_topic.c_str(), MQTT_QOS0, false, payload.c_str()) == 0) {
    Serial.println("MQTT heartbeat publish failed");
  }
}
