#pragma once

#include <Arduino.h>
#include <Storage.h>

#include <map>
#include <vector>

#define OUTBOX_FILE "/outbox.json"
#define OUTBOX_MAX_ENTRIES 256

class MqttTransport;

struct OutboxEntry {
  uint16_t id;
  String topic;
  String payload;
  uint8_t qos;
};

class Outbox {
  private:
    Storage &storage;
    std::vector<OutboxEntry> entries;
    std::map<uint16_t, uint16_t> in_flight;
    uint16_t next_id = 1;

    bool persist();

  public:
    explicit Outbox(Storage &storage);

    bool begin();
    bool enqueue(const String &topic, const String &payload, uint8_t qos);
    void flush(MqttTransport &mqtt);
    void confirm_publish(uint16_t token);
    void reset_in_flight();
};
