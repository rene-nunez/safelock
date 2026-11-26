#include "Lock.h"
#include "pins.h"
#include "config.h"

bool Lock::read_sense_pin() const {
  // The contact closes to GND: LOW means the lock is closed
  return digitalRead(LOCK_SENSE_PIN) == LOCK_SENSE_CLOSED_LEVEL;
}

void Lock::set_coil(bool energized) {
  digitalWrite(LOCK_IN1, energized ? LOCK_ACTIVE_LEVEL : !LOCK_ACTIVE_LEVEL);
}

void Lock::begin() {
  // Set the idle level before switching to output, so the driver never sees a pulse at boot
  set_coil(false);
  pinMode(LOCK_IN1, OUTPUT);
  pinMode(LOCK_SENSE_PIN, INPUT);

  sense_stable = read_sense_pin();
  sense_raw = sense_stable;
  sense_millis = millis();

  Serial.println("Lock begin: ok");
  Serial.print("Lock sensor: ");
  Serial.println(sense_stable ? "closed" : "open");
}

void Lock::set_unlock_ms(uint16_t ms) {
  unlock_ms = ms;
}

void Lock::unlock() {
  unlock(unlock_ms);
}

void Lock::unlock(uint16_t duration_ms) {
  set_coil(true);
  active = true;
  active_ms = duration_ms;
  activated_millis = millis();
  has_command = true;
  command_millis = activated_millis;
  // A manual-open flag already queued must survive until take_manual_open();
  // clearing it here would silently drop the alert.
  Serial.println("Lock unlock: energized");
}

void Lock::update() {
  unsigned long now = millis();
  bool raw = read_sense_pin();

  if (raw != sense_raw) {
    sense_raw = raw;
    sense_millis = now;
  } else if (raw != sense_stable && (now - sense_millis) >= LOCK_SENSE_DEBOUNCE_MS) {
    sense_stable = raw;
    sense_event = true;

    // A bolt that opens without a recent command was released by hand
    if (!sense_stable) {
      bool commanded = has_command && (now - command_millis) <= (active_ms + LOCK_CMD_GRACE_MS);
      manual_open = !commanded;
    }
  }

  if (!active) return;
  if ((now - activated_millis) < active_ms) return;

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

bool Lock::take_manual_open() {
  bool value = manual_open;
  manual_open = false;
  return value;
}
