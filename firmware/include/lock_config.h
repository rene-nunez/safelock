#pragma once

#include <Arduino.h>

#define PASSWORD_LENGTH 5
#define DEFAULT_PASSWORD "12345"

// Temporary allowlist until the backend ACL exists. Canonical UID form
#define ALLOWED_UID_COUNT 1
#define ALLOWED_UIDS { "AA:BB:CC:DD" }

#define LOCK_OPEN_MS 3000 // Unlock pulse duration
#define LOCK_ACTIVE_LEVEL HIGH // DRV8871 IN1 level that energizes the lock
