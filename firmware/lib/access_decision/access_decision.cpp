#include "access_decision.h"

#include <cstring>
#include <strings.h>

namespace {

bool same_uid(const char *left, const char *right) {
  return strcasecmp(left, right) == 0;
}

} // namespace

uint32_t access_age_s(bool clock_valid, time_t now, time_t received_at) {
  if (!clock_valid || received_at == 0 || now < received_at) return 0;
  return static_cast<uint32_t>(now - received_at);
}

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
) {
  if (locked) return {"denied", "door_locked"};
  if (!loaded) return {"denied", "acl_absent"};

  if (access_age_s(clock_valid, now, received_at) > stale_hours * 3600UL) {
    return {"denied", "acl_stale"};
  }
  if (!backend_available && policy != nullptr && strcmp(policy, "deny") == 0) {
    return {"denied", "backend_unreachable"};
  }

  const AccessRule *match = nullptr;
  for (size_t i = 0; i < count; i++) {
    if (same_uid(uid, rules[i].uid)) {
      match = &rules[i];
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
