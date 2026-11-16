#pragma once

#include <Arduino.h>

// PCF8574T, a LED turns on with a LOW output bit
#define PCF8574_LED_ACTIVE_LOW 1

// 1 = passive buzzer with LEDC
// 0 = active buzzer
#define BUZZER_PASSIVE 1

#define BUZZER_LEDC_CHANNEL 0

// Level on the DRV8871 IN1 that energizes the coil
#define LOCK_ACTIVE_LEVEL HIGH

// 1 = the contact shorts the sense pin to GND when the bolt is closed
// 0 = the contact closes to 3V3
#define LOCK_SENSE_ACTIVE_LOW 1

// Coil pulse per unlock; keep it as short as the latch reliably needs
#define LOCK_OPEN_MS 2000

// Stable time before a new sense level is accepted
#define LOCK_SENSE_DEBOUNCE_MS 50

// Temporary until the backend owns the PIN and the ACL
#define PASSWORD_LENGTH   5
#define DEFAULT_PASSWORD  "12345"

// Canonical UID form
#define ALLOWED_UID_COUNT 1
#define ALLOWED_UIDS      { "AA:BB:CC:DD" }
