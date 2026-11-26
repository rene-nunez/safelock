#include <unity.h>

#include <access_decision.h>
#include <protocol.h>

namespace {

constexpr time_t kNow = 1761000000;

AccessRule rule(
  const char *uid,
  bool active = true,
  time_t valid_from = 0,
  time_t valid_to = 0
) {
  return {uid, active, valid_from, valid_to};
}

AccessDecision decide(
  const char *uid,
  const AccessRule *rules,
  size_t count,
  bool locked = false,
  bool loaded = true,
  bool clock_valid = true,
  time_t now = kNow,
  bool backend_available = true,
  const char *policy = "allow",
  uint32_t stale_hours = 72,
  time_t received_at = kNow
) {
  return evaluate_access(
    uid, rules, count, locked, loaded, clock_valid, now, backend_available,
    policy, stale_hours, received_at
  );
}

void test_grant_is_case_insensitive() {
  const AccessRule rules[] = {rule("AA:BB:CC:DD")};
  const AccessDecision result = decide("aa:bb:cc:dd", rules, 1);
  TEST_ASSERT_EQUAL_STRING("granted", result.decision);
  TEST_ASSERT_EQUAL_STRING("acl_match", result.reason);
}

void test_local_denials() {
  const AccessRule rules[] = {rule("AA:BB:CC:DD")};

  TEST_ASSERT_EQUAL_STRING(
    "door_locked", decide("AA:BB:CC:DD", rules, 1, true).reason
  );
  TEST_ASSERT_EQUAL_STRING(
    "acl_absent", decide("AA:BB:CC:DD", rules, 1, false, false).reason
  );
  TEST_ASSERT_EQUAL_STRING(
    "acl_absent", decide("11:22:33:44", rules, 1).reason
  );
  const AccessRule inactive[] = {rule("AA:BB:CC:DD", false)};
  TEST_ASSERT_EQUAL_STRING(
    "acl_absent", decide("AA:BB:CC:DD", inactive, 1).reason
  );
}

void test_offline_and_stale_policies() {
  const AccessRule rules[] = {rule("AA:BB:CC:DD")};

  TEST_ASSERT_EQUAL_STRING(
    "backend_unreachable",
    decide("AA:BB:CC:DD", rules, 1, false, true, true, kNow, false, "deny").reason
  );
  TEST_ASSERT_EQUAL_STRING(
    "acl_stale",
    decide("AA:BB:CC:DD", rules, 1, false, true, true, kNow, true, "allow",
           72, kNow - 73 * 3600).reason
  );
}

void test_validity_windows() {
  const AccessRule future[] = {rule("AA:BB:CC:DD", true, kNow + 60)};
  const AccessRule expired[] = {rule("AA:BB:CC:DD", true, 0, kNow - 60)};

  TEST_ASSERT_EQUAL_STRING(
    "not_yet_valid", decide("AA:BB:CC:DD", future, 1).reason
  );
  TEST_ASSERT_EQUAL_STRING(
    "expired", decide("AA:BB:CC:DD", expired, 1).reason
  );
  // Without a valid clock, expiry checks are skipped instead of denying.
  TEST_ASSERT_EQUAL_STRING(
    "granted", decide("AA:BB:CC:DD", expired, 1, false, true, false).decision
  );
}

void test_age_s_requires_a_valid_clock() {
  TEST_ASSERT_EQUAL_UINT32(0, access_age_s(false, kNow, kNow - 1000));
  TEST_ASSERT_EQUAL_UINT32(0, access_age_s(true, kNow, kNow + 1000));
  TEST_ASSERT_EQUAL_UINT32(1000, access_age_s(true, kNow, kNow - 1000));
}

void test_command_envelope_requires_expiry() {
  JsonDocument document;
  JsonObject data = document["data"].to<JsonObject>();
  data["request_id"] = "sl-0001";

  protocol::CommandEnvelope missing = protocol::parse_command_envelope(document.as<JsonObject>());
  TEST_ASSERT_TRUE(missing.valid == false);
  TEST_ASSERT_EQUAL_STRING("sl-0001", missing.request_id.c_str());

  data["expires_at"] = kNow + 60;
  protocol::CommandEnvelope valid = protocol::parse_command_envelope(document.as<JsonObject>());
  TEST_ASSERT_TRUE(valid.valid);
  TEST_ASSERT_FALSE(protocol::command_expired(valid, kNow));
  TEST_ASSERT_TRUE(protocol::command_expired(valid, kNow + 61));

  data["expires_at"] = -1;
  TEST_ASSERT_FALSE(protocol::parse_command_envelope(document.as<JsonObject>()).valid);
}

void test_command_envelope_without_request_id() {
  JsonDocument document;
  document["data"].to<JsonObject>();
  TEST_ASSERT_FALSE(protocol::parse_command_envelope(document.as<JsonObject>()).valid);
}

JsonDocument snapshot_document(time_t valid_to) {
  JsonDocument document;
  document["acl_version"] = 7;
  document["requires_pin"] = false;
  document["locked"] = true;
  document["offline_policy"] = "deny";
  document["stale_acl_hours"] = 72;
  document["unlock_ms"] = 3000;
  document["received_at"] = static_cast<uint64_t>(kNow);

  JsonArray entries = document["entries"].to<JsonArray>();
  JsonObject entry = entries.add<JsonObject>();
  entry["uid"] = "AA:BB:CC:DD";
  entry["credential_id"] = "cred-1";
  entry["status"] = "active";
  entry["valid_from"] = nullptr;
  entry["valid_to"] = static_cast<uint64_t>(valid_to);
  return document;
}

void test_complete_snapshot_parse_and_roundtrip() {
  // 2038-01-01 is stored as uint32/uint64 by ArduinoJson, not as int.
  constexpr time_t after_2038 = 1893456000;
  JsonDocument document = snapshot_document(after_2038);

  protocol::Snapshot snapshot;
  TEST_ASSERT_TRUE(protocol::parse_snapshot(document.as<JsonObject>(), snapshot, 3000, 72));
  TEST_ASSERT_EQUAL_UINT32(7, snapshot.version);
  TEST_ASSERT_FALSE(snapshot.requires_pin);
  TEST_ASSERT_TRUE(snapshot.locked);
  TEST_ASSERT_EQUAL_STRING("deny", snapshot.policy.c_str());
  TEST_ASSERT_EQUAL_UINT16(3000, snapshot.unlock_ms);
  TEST_ASSERT_EQUAL_UINT32(1, snapshot.entries.size());
  TEST_ASSERT_EQUAL_UINT32(after_2038, snapshot.entries[0].valid_to);
  TEST_ASSERT_EQUAL_UINT32(kNow, snapshot.received_at);

  // Rebuild the persisted document as the firmware does and verify nothing
  // is lost: a restored snapshot must keep its version, stamp and dates.
  JsonDocument persisted = snapshot_document(after_2038);
  char buffer[1024];
  serializeJson(persisted, buffer, sizeof(buffer));

  JsonDocument restored;
  TEST_ASSERT_TRUE(deserializeJson(restored, buffer) == DeserializationError::Ok);
  protocol::Snapshot reparsed;
  TEST_ASSERT_TRUE(protocol::parse_snapshot(restored.as<JsonObject>(), reparsed, 3000, 72));
  TEST_ASSERT_EQUAL_UINT32(snapshot.version, reparsed.version);
  TEST_ASSERT_EQUAL_UINT32(snapshot.received_at, reparsed.received_at);
  TEST_ASSERT_EQUAL_UINT32(snapshot.entries[0].valid_to, reparsed.entries[0].valid_to);
}

void test_invalid_snapshots_are_rejected() {
  JsonDocument document = snapshot_document(0);

  document["acl_version"] = -1;
  protocol::Snapshot snapshot;
  TEST_ASSERT_FALSE(protocol::parse_snapshot(document.as<JsonObject>(), snapshot, 3000, 72));

  document = snapshot_document(0);
  document["stale_acl_hours"] = 0;
  TEST_ASSERT_FALSE(protocol::parse_snapshot(document.as<JsonObject>(), snapshot, 3000, 72));

  document = snapshot_document(0);
  document["unlock_ms"] = 50;
  TEST_ASSERT_FALSE(protocol::parse_snapshot(document.as<JsonObject>(), snapshot, 3000, 72));

  document = snapshot_document(0);
  document["entries"][0]["uid"] = "";
  TEST_ASSERT_FALSE(protocol::parse_snapshot(document.as<JsonObject>(), snapshot, 3000, 72));

  document = snapshot_document(0);
  document["offline_policy"] = "unknown";
  TEST_ASSERT_FALSE(protocol::parse_snapshot(document.as<JsonObject>(), snapshot, 3000, 72));
}

} // namespace

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_grant_is_case_insensitive);
  RUN_TEST(test_local_denials);
  RUN_TEST(test_offline_and_stale_policies);
  RUN_TEST(test_validity_windows);
  RUN_TEST(test_age_s_requires_a_valid_clock);
  RUN_TEST(test_command_envelope_requires_expiry);
  RUN_TEST(test_command_envelope_without_request_id);
  RUN_TEST(test_complete_snapshot_parse_and_roundtrip);
  RUN_TEST(test_invalid_snapshots_are_rejected);
  return UNITY_END();
}
