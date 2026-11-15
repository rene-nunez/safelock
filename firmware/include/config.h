#pragma once

#include <Arduino.h>

// Settings
#define PCF8574_LED_ACTIVE_LOW 1
#define BUZZER_PASSIVE         1
#define BUZZER_LEDC_CHANNEL    0
#define LOCK_ACTIVE_LEVEL      HIGH
#define LOCK_SENSE_ACTIVE_LOW  1

// Timing
#define LOCK_OPEN_MS           3000 // Unlock pulse duration
#define LOCK_SENSE_DEBOUNCE_MS 50

// Temporary until the backend owns the PIN and the ACL
#define PASSWORD_LENGTH   5
#define DEFAULT_PASSWORD  "12345"
#define ALLOWED_UID_COUNT 1
#define ALLOWED_UIDS      { "AA:BB:CC:DD" }
