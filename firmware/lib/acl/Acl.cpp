#include "Acl.h"

#include "config.h"

#include <limits>

namespace {

// ArduinoJson stores timestamps above 2038 as uint32/uint64, not as int.
time_t optional_epoch(JsonVariantConst value) {
  if (value.is<int>()) {
    const int epoch = value.as<int>();
    return epoch > 0 ? static_cast<time_t>(epoch) : 0;
  }
  if (value.is<uint32_t>()) return static_cast<time_t>(value.as<uint32_t>());
  if (value.is<uint64_t>()) {
    const uint64_t epoch = value.as<uint64_t>();
    if (epoch > static_cast<uint64_t>(std::numeric_limits<time_t>::max())) return 0;
    return static_cast<time_t>(epoch);
  }
  return 0;
}

} // namespace

Acl::Acl(Storage &storage) : storage(storage), unlock_duration(LOCK_OPEN_MS) {}

bool Acl::parse(const JsonObject &data, bool persist, time_t now) {
  if (!data["acl_version"].is<int>()) return false;
  if (!data["entries"].is<JsonArray>()) return false;

  const int raw_version = data["acl_version"].as<int>();
  if (raw_version < 0) return false;
  const uint32_t new_version = static_cast<uint32_t>(raw_version);
  const bool new_requires_pin = data["requires_pin"] | false;
  const bool new_locked = data["locked"] | false;
  const String new_policy = data["offline_policy"] | "allow";
  if (new_policy != "allow" && new_policy != "deny") return false;

  const uint16_t new_stale_hours = data["stale_acl_hours"] | 72;
  const uint16_t new_unlock_ms = data["unlock_ms"] | LOCK_OPEN_MS;
  if (new_stale_hours == 0) return false;
  if (new_unlock_ms < 100 || new_unlock_ms > 10000) return false;

  std::vector<AclEntry> staged;
  for (JsonObject item : data["entries"].as<JsonArray>()) {
    if (staged.size() >= ACL_MAX_ENTRIES) return false;

    AclEntry entry;
    entry.uid = item["uid"] | "";
    entry.credential_id = item["credential_id"] | "";
    entry.active = String(item["status"] | "active") == "active";
    entry.valid_from = optional_epoch(item["valid_from"]);
    entry.valid_to = optional_epoch(item["valid_to"]);
    if (entry.uid.length() == 0 || entry.credential_id.length() == 0) return false;

    staged.push_back(entry);
  }

  // A restored snapshot keeps its original receive time: stale detection must survive a reboot.
  // Stamp fresh snapshots from the network epoch (now), not from the RTC flag: the DS1307 can
  // be missing while SNTP still provides a trustworthy timestamp. A zero would disable aging.
  time_t new_received = 0;

  if (persist) {
    new_received = (now > 0) ? now : 0;
  } else if (data["received_at"].is<uint64_t>()) {
    new_received = static_cast<time_t>(data["received_at"].as<uint64_t>());
  }

  if (persist) {
    JsonDocument document;
    document["acl_version"] = new_version;
    document["requires_pin"] = new_requires_pin;
    document["locked"] = new_locked;
    document["offline_policy"] = new_policy;
    document["stale_acl_hours"] = new_stale_hours;
    document["unlock_ms"] = new_unlock_ms;
    document["received_at"] = static_cast<uint64_t>(new_received);

    JsonArray output = document["entries"].to<JsonArray>();
    for (const AclEntry &entry : staged) {
      JsonObject item = output.add<JsonObject>();
      item["uid"] = entry.uid;
      item["credential_id"] = entry.credential_id;
      item["status"] = entry.active ? "active" : "inactive";
      if (entry.valid_from > 0) {
        item["valid_from"] = static_cast<uint64_t>(entry.valid_from);
      } else {
        item["valid_from"] = nullptr;
      }
      if (entry.valid_to > 0) {
        item["valid_to"] = static_cast<uint64_t>(entry.valid_to);
      } else {
        item["valid_to"] = nullptr;
      }
    }

    String payload;
    serializeJson(document, payload);
    if (!storage.write_atomic(ACL_FILE, ACL_TEMP_FILE, payload)) {
      Serial.println("ACL snapshot write failed");
      return false;
    }
  }

  entries = staged;
  version = new_version;
  requires_pin = new_requires_pin;
  locked = new_locked;
  policy = new_policy;
  stale_hours = new_stale_hours;
  unlock_duration = new_unlock_ms;
  received_at = new_received;
  loaded = true;
  return true;
}

bool Acl::begin() {
  if (!storage.is_ready()) return false;

  String payload;
  if (!storage.read_file_with_fallback(ACL_FILE, ACL_TEMP_FILE, payload)) return false;

  JsonDocument document;
  if (deserializeJson(document, payload) != DeserializationError::Ok) return false;
  return parse(document.as<JsonObject>(), false, time(nullptr));
}

bool Acl::apply(const JsonObject &data, time_t now) {
  return parse(data, true, now);
}

AclDecision Acl::evaluate(const String &uid, bool clock_valid, time_t now, bool backend_available) const {
  if (locked) return {"denied", "door_locked"};
  // requires_pin is a second factor handled by Tasks with the backend,
  // not a reason to reject the card in the local evaluator.
  if (!loaded) return {"denied", "acl_absent"};
  if (clock_valid && age_s(clock_valid, now) > stale_hours * 3600UL) {
    return {"denied", "acl_stale"};
  }
  if (!backend_available && policy == "deny") {
    return {"denied", "backend_unreachable"};
  }

  const AclEntry *match = nullptr;
  for (const AclEntry &entry : entries) {
    if (uid.equalsIgnoreCase(entry.uid)) {
      match = &entry;
      break;
    }
  }
  if (match == nullptr || !match->active) return {"denied", "acl_absent"};

  if (clock_valid) {
    if (match->valid_from > 0 && now < match->valid_from) {
      return {"denied", "not_yet_valid"};
    }
    if (match->valid_to > 0 && now > match->valid_to) {
      return {"denied", "expired"};
    }
  }

  return {"granted", "acl_match"};
}

const String &Acl::credential_id_for(const String &uid) const {
  static const String empty;
  for (const AclEntry &entry : entries) {
    if (uid.equalsIgnoreCase(entry.uid)) return entry.credential_id;
  }
  return empty;
}

uint32_t Acl::age_s(bool clock_valid, time_t now) const {
  if (!clock_valid || received_at == 0 || now < received_at) return 0;
  return static_cast<uint32_t>(now - received_at);
}

bool Acl::has_received_at() const { return received_at > 0; }
uint32_t Acl::get_version() const { return version; }
bool Acl::get_requires_pin() const { return requires_pin; }
bool Acl::get_locked() const { return locked; }
uint16_t Acl::get_unlock_ms() const { return unlock_duration; }
