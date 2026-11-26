#include "Outbox.h"

#include <ArduinoJson.h>

#include <MqttTransport.h>

Outbox::Outbox(Storage &storage) : storage(storage) {}

bool Outbox::begin() {
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

bool Outbox::persist() {
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
  return storage.write_atomic(OUTBOX_FILE, OUTBOX_TMP_FILE, payload);
}

bool Outbox::enqueue(const String &topic, const String &payload, uint8_t qos) {
  while (entries.size() >= OUTBOX_MAX_ENTRIES) {
    const uint16_t dropped_id = entries.front().id;
    entries.erase(entries.begin());
    for (auto it = in_flight.begin(); it != in_flight.end();) {
      if (it->second == dropped_id) {
        it = in_flight.erase(it);
      } else {
        ++it;
      }
    }
    Serial.printf("Outbox: dropped oldest id=%u (full)\n", static_cast<unsigned>(dropped_id));
  }

  OutboxEntry entry;
  entry.id = next_id++;
  entry.topic = topic;
  entry.payload = payload;
  entry.qos = qos;
  entries.push_back(entry);

  if (!persist()) {
    entries.pop_back();
    Serial.println("Outbox: persist failed; entry dropped");
    return false;
  }
  Serial.printf(
    "Outbox: queued id=%u qos=%u (%u pending)\n",
    static_cast<unsigned>(entry.id),
    static_cast<unsigned>(qos),
    static_cast<unsigned>(entries.size())
  );
  return true;
}

void Outbox::flush(MqttTransport &mqtt) {
  unsigned sent = 0;
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
    if (token == 0) continue;

    // QoS0 has no PUBACK and the library reports token 1 for every publish.
    if (entry.qos > 0) in_flight[token] = entry.id;
    sent++;
  }

  if (sent > 0) {
    Serial.printf(
      "Outbox: flushed %u (pending=%u, in-flight=%u)\n",
      sent,
      static_cast<unsigned>(entries.size()),
      static_cast<unsigned>(in_flight.size())
    );
  }
}

void Outbox::confirm_publish(uint16_t token) {
  const auto pending = in_flight.find(token);
  if (pending == in_flight.end()) return;

  const uint16_t entry_id = pending->second;
  in_flight.erase(pending);

  for (auto it = entries.begin(); it != entries.end(); ++it) {
    if (it->id == entry_id) {
      entries.erase(it);
      Serial.printf(
        "Outbox: confirmed id=%u (%u pending)\n",
        static_cast<unsigned>(entry_id),
        static_cast<unsigned>(entries.size())
      );
      persist();
      return;
    }
  }
}

void Outbox::reset_in_flight() {
  if (!in_flight.empty()) {
    Serial.printf("Outbox: reset %u in-flight\n", static_cast<unsigned>(in_flight.size()));
  }
  in_flight.clear();
}
