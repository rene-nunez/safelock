#pragma once

#include <ArduinoJson.h>

#include <cstddef>
#include <cstdint>
#include <ctime>
#include <string>
#include <vector>

namespace protocol {

constexpr size_t MAX_SNAPSHOT_ENTRIES = 256;

struct CommandEnvelope {
  bool valid = false;
  std::string request_id;
  int64_t expires_at = 0;
};

struct SnapshotEntry {
  std::string uid;
  std::string credential_id;
  bool active = true;
  time_t valid_from = 0;
  time_t valid_to = 0;
};

struct Snapshot {
  uint32_t version = 0;
  bool requires_pin = false;
  bool locked = false;
  std::string policy = "allow";
  uint16_t stale_hours = 72;
  uint16_t unlock_ms = 3000;
  time_t received_at = 0;
  std::vector<SnapshotEntry> entries;
};

// Only the fields the device needs from a command are parsed here, so the
// same rules can be tested natively without the MQTT transport.
CommandEnvelope parse_command_envelope(JsonObject envelope);
bool command_expired(const CommandEnvelope &envelope, time_t now);

// Full ACL snapshot validation, shared by the firmware and native tests.
bool parse_snapshot(
  JsonObject data,
  Snapshot &out,
  uint16_t default_unlock_ms,
  uint16_t default_stale_hours
);

} // namespace protocol
