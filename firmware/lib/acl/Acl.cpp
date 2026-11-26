#include "Acl.h"

#include <access_decision.h>
#include <protocol.h>

#include "config.h"

Acl::Acl(Storage &storage) : storage(storage), unlock_duration(LOCK_OPEN_MS) {}

bool Acl::parse(const JsonObject &data, bool persist, time_t now) {
  protocol::Snapshot snapshot;
  if (!protocol::parse_snapshot(data, snapshot, LOCK_OPEN_MS, 72)) return false;

  std::vector<AclEntry> staged;
  for (const protocol::SnapshotEntry &item : snapshot.entries) {
    AclEntry entry;
    entry.uid = item.uid.c_str();
    entry.credential_id = item.credential_id.c_str();
    entry.active = item.active;
    entry.valid_from = item.valid_from;
    entry.valid_to = item.valid_to;
    staged.push_back(entry);
  }

  // A restored snapshot keeps its original receive time: stale detection must survive a reboot.
  // Stamp fresh snapshots from the network epoch (now), not from the RTC flag: the DS1307 can
  // be missing while SNTP still provides a trustworthy timestamp. A zero would disable aging.
  const time_t new_received = persist ? ((now > 0) ? now : 0) : snapshot.received_at;

  if (persist) {
    JsonDocument document;
    document["acl_version"] = snapshot.version;
    document["requires_pin"] = snapshot.requires_pin;
    document["locked"] = snapshot.locked;
    document["offline_policy"] = snapshot.policy;
    document["stale_acl_hours"] = snapshot.stale_hours;
    document["unlock_ms"] = snapshot.unlock_ms;
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
  version = snapshot.version;
  requires_pin = snapshot.requires_pin;
  locked = snapshot.locked;
  policy = snapshot.policy.c_str();
  stale_hours = snapshot.stale_hours;
  unlock_duration = snapshot.unlock_ms;
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
  // requires_pin is a second factor handled by Tasks with the backend,
  // not a reason to reject the card in the local evaluator.
  std::vector<AccessRule> rules;
  rules.reserve(entries.size());
  for (const AclEntry &entry : entries) {
    rules.push_back({entry.uid.c_str(), entry.active, entry.valid_from, entry.valid_to});
  }

  const AccessDecision result = evaluate_access(
    uid.c_str(), rules.data(), rules.size(), locked, loaded, clock_valid, now,
    backend_available, policy.c_str(), stale_hours, received_at
  );
  return {result.decision, result.reason};
}

const String &Acl::credential_id_for(const String &uid) const {
  static const String empty;
  for (const AclEntry &entry : entries) {
    if (uid.equalsIgnoreCase(entry.uid)) return entry.credential_id;
  }
  return empty;
}

uint32_t Acl::age_s(bool clock_valid, time_t now) const {
  return access_age_s(clock_valid, now, received_at);
}

bool Acl::has_received_at() const { return received_at > 0; }
uint32_t Acl::get_version() const { return version; }
bool Acl::get_requires_pin() const { return requires_pin; }
bool Acl::get_locked() const { return locked; }
uint16_t Acl::get_unlock_ms() const { return unlock_duration; }
