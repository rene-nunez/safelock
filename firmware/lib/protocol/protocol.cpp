#include "protocol.h"

#include <cstring>
#include <limits>

namespace protocol {

CommandEnvelope parse_command_envelope(JsonObject envelope) {
  CommandEnvelope result;
  const JsonObject data = envelope["data"].as<JsonObject>();

  const char *request_id = data["request_id"];
  if (request_id == nullptr || request_id[0] == '\0') return result;
  result.request_id = request_id;

  const JsonVariantConst expiry = data["expires_at"];
  if (expiry.is<int>()) {
    result.expires_at = expiry.as<int>();
  } else if (expiry.is<int64_t>()) {
    result.expires_at = expiry.as<int64_t>();
  } else if (expiry.is<uint64_t>()) {
    const uint64_t value = expiry.as<uint64_t>();
    if (value <= static_cast<uint64_t>(INT64_MAX)) {
      result.expires_at = static_cast<int64_t>(value);
    }
  }

  // Commands without a positive deadline must never be accepted: a retained
  // or replayed publish would otherwise open the door indefinitely.
  result.valid = result.expires_at > 0;
  return result;
}

bool command_expired(const CommandEnvelope &envelope, time_t now) {
  return now > 0 && static_cast<int64_t>(now) > envelope.expires_at;
}

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

time_t optional_received_at(JsonVariantConst value) {
  const time_t epoch = optional_epoch(value);
  return epoch;
}

} // namespace

bool parse_snapshot(
  JsonObject data,
  Snapshot &out,
  uint16_t default_unlock_ms,
  uint16_t default_stale_hours
) {
  Snapshot staged;

  if (!data["acl_version"].is<int>()) return false;
  const int raw_version = data["acl_version"].as<int>();
  if (raw_version < 0) return false;
  staged.version = static_cast<uint32_t>(raw_version);
  if (!data["entries"].is<JsonArray>()) return false;

  staged.requires_pin = data["requires_pin"] | false;
  staged.locked = data["locked"] | false;
  const char *policy = data["offline_policy"] | "allow";
  staged.policy = policy == nullptr ? "" : policy;
  if (staged.policy != "allow" && staged.policy != "deny") return false;

  staged.stale_hours = data["stale_acl_hours"] | default_stale_hours;
  staged.unlock_ms = data["unlock_ms"] | default_unlock_ms;
  if (staged.stale_hours == 0) return false;
  if (staged.unlock_ms < 100 || staged.unlock_ms > 10000) return false;

  for (JsonObject item : data["entries"].as<JsonArray>()) {
    if (staged.entries.size() >= MAX_SNAPSHOT_ENTRIES) return false;

    SnapshotEntry entry;
    const char *uid = item["uid"];
    const char *credential_id = item["credential_id"];
    const char *status = item["status"] | "active";
    entry.uid = uid == nullptr ? "" : uid;
    entry.credential_id = credential_id == nullptr ? "" : credential_id;
    entry.active = status != nullptr && strcmp(status, "active") == 0;
    entry.valid_from = optional_epoch(item["valid_from"]);
    entry.valid_to = optional_epoch(item["valid_to"]);
    if (entry.uid.empty() || entry.credential_id.empty()) return false;

    staged.entries.push_back(entry);
  }

  staged.received_at = optional_received_at(data["received_at"]);
  out = staged;
  return true;
}

} // namespace protocol
