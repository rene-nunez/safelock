#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Storage.h>

#include <time.h>
#include <vector>

#define ACL_FILE "/acl.json"
#define ACL_TEMP_FILE "/acl.tmp"
#define ACL_MAX_ENTRIES 256

struct AclEntry {
  String uid;
  String credential_id;
  String holder_id;
  bool active;
  time_t valid_from;
  time_t valid_to;
};

struct AclDecision {
  const char *decision;
  const char *reason;
};

class Acl {
  private:
    Storage &storage;

    std::vector<AclEntry> entries;
    uint32_t version = 0;
    time_t received_at = 0;
    bool requires_pin = false;
    bool locked = false;
    String policy = "allow";
    uint16_t stale_hours = 72;
    uint16_t unlock_duration = 3000;
    bool loaded = false;

    bool parse(const JsonObject &data, bool persist, bool clock_valid, time_t now);

  public:
    explicit Acl(Storage &storage);

    bool begin();
    bool apply(const JsonObject &data, bool clock_valid, time_t now);

    AclDecision evaluate(
      const String &uid, bool clock_valid, time_t now, bool backend_available
    ) const;
    const String &credential_id_for(const String &uid) const;
    uint32_t age_s(bool clock_valid, time_t now) const;

    bool is_loaded() const;
    uint32_t get_version() const;
    bool get_requires_pin() const;
    bool get_locked() const;
    const String &get_policy() const;
    uint16_t get_stale_hours() const;
    uint16_t get_unlock_ms() const;
};
