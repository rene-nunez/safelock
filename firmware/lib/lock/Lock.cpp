#include "Lock.h"
#include "pins.h"
#include "config.h"

bool Lock::read_sense_pin() const {
  bool level = digitalRead(LOCK_SENSE_PIN) == HIGH;

#if LOCK_SENSE_ACTIVE_LOW
  // The contact closes to GND: LOW means the lock is closed
  return !level;
#else
  return level;
#endif
}

void Lock::set_coil(bool energized) {
  digitalWrite(LOCK_IN1, energized ? LOCK_ACTIVE_LEVEL : !LOCK_ACTIVE_LEVEL);
}

void Lock::begin() {
  // Set the idle level before switching to output, so the driver never sees a
  // pulse at boot
  set_coil(false);
  pinMode(LOCK_IN1, OUTPUT);

  // GPIO34 has no internal pull-up: the external 10k to 3V3 is mandatory
  pinMode(LOCK_SENSE_PIN, INPUT);
  sense_stable = read_sense_pin();
  sense_raw = sense_stable;
  sense_millis = millis();

  Serial.println("Lock begin: ok");
  Serial.print("Lock sensor: ");
  Serial.println(sense_stable ? "closed" : "open");
}

void Lock::unlock() {
  set_coil(true);
  active = true;
  activated_millis = millis();
  Serial.println("Lock unlock: energized");
}

void Lock::update() {
  unsigned long now = millis();
  bool raw = read_sense_pin();

  if (raw != sense_raw) {
    sense_raw = raw;
    sense_millis = now;
  } else if (raw != sense_stable &&
             (now - sense_millis) >= LOCK_SENSE_DEBOUNCE_MS) {
    sense_stable = raw;
    sense_event = true;
  }

  if (!active) return;
  if ((now - activated_millis) < LOCK_OPEN_MS) return;

  set_coil(false);
  active = false;
  Serial.println("Lock unlock: released");
}

bool Lock::is_active() const {
  return active;
}

bool Lock::is_closed() const {
  return sense_stable;
}

bool Lock::sense_changed() {
  bool changed = sense_event;
  sense_event = false;
  return changed;
}
