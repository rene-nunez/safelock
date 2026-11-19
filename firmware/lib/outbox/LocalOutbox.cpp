#include "LocalOutbox.h"

#include <ArduinoJson.h>

#include <MqttTransport.h>

LocalOutbox::LocalOutbox(Storage &storage) : storage(storage) {}

bool LocalOutbox::begin() {
  if (!storage.is_ready()) return false;

  std::vector<String> lines;
  if (!storage.read_lines(OUTBOX_FILE, lines)) return true;

  next_id = 1;
  for (const String &line : lines) {
    JsonDocument document;
    if (deserializeJson(document, line) != DeserializationError::Ok) continue;

    OutboxEntry entry;
    entry.id = document["id"] | 0;
    entry.topic = document["topic"] | "";
    entry.payload = document["payload"] | "";
    entry.qos = document["qos"] | 0;
    if (entry.id == 0 || entry.topic.length() == 0 || entry.payload.length() == 0) {
      continue;
    }

    entries.push_back(entry);
    if (entry.id >= next_id) next_id = entry.id + 1;
  }
  return true;
}

bool LocalOutbox::persist() {
  String payload;
  for (const OutboxEntry &entry : entries) {
    JsonDocument document;
    document["id"] = entry.id;
    document["topic"] = entry.topic;
    document["payload"] = entry.payload;
    document["qos"] = entry.qos;
    serializeJson(document, payload);
    payload += '\n';
  }
  return storage.write_file(OUTBOX_FILE, payload);
}

bool LocalOutbox::enqueue(const String &topic, const String &payload, uint8_t qos) {
  while (entries.size() >= OUTBOX_MAX_ENTRIES) {
    entries.erase(entries.begin());
  }

  OutboxEntry entry;
  entry.id = next_id++;
  entry.topic = topic;
  entry.payload = payload;
  entry.qos = qos;
  entries.push_back(entry);

  if (!persist()) {
    entries.pop_back();
    return false;
  }
  return true;
}

void LocalOutbox::flush(MqttTransport &mqtt) {
  for (const OutboxEntry &entry : entries) {
    bool already_sent = false;
    for (const auto &pending : in_flight) {
      if (pending.second == entry.id) {
        already_sent = true;
        break;
      }
    }
    if (already_sent) continue;

    const uint16_t token = mqtt.publish_queued(
      entry.topic.c_str(), entry.payload, entry.qos
    );
    if (token > 0) in_flight[token] = entry.id;
  }
}

void LocalOutbox::confirm_publish(uint16_t token) {
  const auto pending = in_flight.find(token);
  if (pending == in_flight.end()) return;

  const uint16_t entry_id = pending->second;
  in_flight.erase(pending);

  for (auto it = entries.begin(); it != entries.end(); ++it) {
    if (it->id == entry_id) {
      entries.erase(it);
      persist();
      return;
    }
  }
}

void LocalOutbox::reset_in_flight() {
  in_flight.clear();
}
