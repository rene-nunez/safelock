#pragma once

#include <Arduino.h>

#define PASSWORD_LENGTH 5
#define DEFAULT_PASSWORD "12345"

#define LOCK_OPEN_MS 3000 // unlock pulse duration
#define LOCK_ACTIVE_LEVEL HIGH // DRV8871 IN1 level that energizes the lock
