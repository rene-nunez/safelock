#pragma once

#include <cstddef>
#include <cstdint>
#include <ctime>

struct AccessRule {
  const char *uid;
  bool active;
  time_t valid_from;
  time_t valid_to;
};

struct AccessDecision {
  const char *decision;
  const char *reason;
};

// Platform-independent access rules shared by the firmware and native tests.
AccessDecision evaluate_access(
  const char *uid,
  const AccessRule *rules,
  size_t count,
  bool locked,
  bool loaded,
  bool clock_valid,
  time_t now,
  bool backend_available,
  const char *policy,
  uint32_t stale_hours,
  time_t received_at
);

uint32_t access_age_s(bool clock_valid, time_t now, time_t received_at);
