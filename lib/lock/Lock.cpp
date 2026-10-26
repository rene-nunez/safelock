#include "Lock.h"
#include "pins.h"
#include "lock_config.h"

solenoid_lock::solenoid_lock() {}

void solenoid_lock::begin() {
  pinMode(LOCK_IN1, OUTPUT);
  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL == HIGH ? LOW : HIGH);
  Serial.println("Lock driver initialized");
}

void solenoid_lock::unlock() {
  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL);
  active = true;
  activated_millis = millis();
  Serial.println("Lock energized");
}

void solenoid_lock::update() {
  if (!active) return;
  if ((millis() - activated_millis) < LOCK_OPEN_MS) return;

  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL == HIGH ? LOW : HIGH);
  active = false;
  Serial.println("Lock released");
}

bool solenoid_lock::is_active() {
  return active;
}
