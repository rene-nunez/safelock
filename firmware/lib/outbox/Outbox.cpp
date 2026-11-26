#include "Outbox.h"

#include <ArduinoJson.h>

#include <MqttTransport.h>

Outbox::Outbox(Storage &storage) : storage(storage) {}

bool Outbox::begin() {
  if (!storage.is_ready()) return false;

  std::vector<String> lines;
  String payload;
  if (!storage.read_file_with_fallback(OUTBOX_FILE, OUTBOX_TMP_FILE, payload)) return true;

  lines.clear();
  size_t start = 0;
  while (start < payload.length()) {
    const int end = payload.indexOf('\n', start);
    String line = (end < 0) ? payload.substring(start) : payload.substring(start, end);
    line.trim();
    if (line.length() > 0) lines.push_back(line);
    if (end < 0) break;
    start = static_cast<size_t>(end) + 1;
  }

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

    // serializeJson clears the destination String, so append through a line.
    String line;
    serializeJson(document, line);
    payload += line;
    payload += '\n';
  }
  return storage.write_atomic(OUTBOX_FILE, OUTBOX_TMP_FILE, payload);
}

bool Outbox::enqueue(const String &topic, const String &payload, uint8_t qos) {
  // Keep the dropped entries until the new snapshot is on disk: if the write
  // fails, restoring them is the only way to avoid losing events silently.
  std::vector<OutboxEntry> dropped;
  while (entries.size() >= OUTBOX_MAX_ENTRIES) {
    dropped.push_back(entries.front());
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
    entries.insert(entries.begin(), dropped.begin(), dropped.end());
    Serial.println("Outbox: persist failed; entry dropped");
    return false;
  }

  for (const OutboxEntry &old : dropped) {
    for (auto it = in_flight.begin(); it != in_flight.end();) {
      if (it->second == old.id) {
        it = in_flight.erase(it);
      } else {
        ++it;
      }
    }
    Serial.printf("Outbox: dropped oldest id=%u (full)\n", static_cast<unsigned>(old.id));
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
  std::vector<uint16_t> sent_without_ack;
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

    if (entry.qos > 0) {
      in_flight[token] = entry.id;
    } else {
      // QoS0 has no PUBACK: remove it now instead of republishing forever.
      sent_without_ack.push_back(entry.id);
    }
    sent++;
  }

  if (!sent_without_ack.empty()) {
    for (uint16_t id : sent_without_ack) {
      for (auto it = entries.begin(); it != entries.end(); ++it) {
        if (it->id == id) {
          entries.erase(it);
          break;
        }
      }
    }
    persist();
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
