#include "Lock.h"
#include "pins.h"
#include "lock_config.h"

solenoid_lock::solenoid_lock() {}

void solenoid_lock::begin() {
  pinMode(LOCK_IN1, OUTPUT);
  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL == HIGH ? LOW : HIGH);
  pinMode(LOCK_SENSOR, INPUT);
  Serial.println("Lock driver initialized");
}

void solenoid_lock::unlock() {
  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL);
  active = true;
  activated_millis = millis();
  Serial.println("Lock energized");
}

void solenoid_lock::update() {
  bool reading_closed = digitalRead(LOCK_SENSOR) == LOCK_SENSOR_CLOSED_LEVEL;

  if (!sensor_state_initialized || reading_closed != sensor_candidate_closed) {
    sensor_candidate_closed = reading_closed;
    sensor_candidate_millis = millis();

    if (!sensor_state_initialized) {
      sensor_state_initialized = true;
      return;
    }
  }

  if ((!sensor_state_reported || reading_closed != sensor_closed) &&
      (millis() - sensor_candidate_millis) >= LOCK_SENSOR_DEBOUNCE_MS) {
    sensor_closed = reading_closed;
    sensor_state_reported = true;
    Serial.println(sensor_closed ? "Cerradura cerrada" : "Cerradura abierta");
  }

  if (!active) return;
  if ((millis() - activated_millis) < LOCK_OPEN_MS) return;

  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL == HIGH ? LOW : HIGH);
  active = false;
  Serial.println("Lock released");
}

bool solenoid_lock::is_active() {
  return active;
}
