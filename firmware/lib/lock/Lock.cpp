#include "Lock.h"
#include "pins.h"
#include "lock_config.h"

Lock::Lock() {}

bool Lock::read_sense_pin() {
  bool level = digitalRead(LOCK_SENSE_PIN) == HIGH;

#if LOCK_SENSE_ACTIVE_LOW
  // El contacto cierra a GND: LOW significa cerradura cerrada.
  return !level;
#else
  return level;
#endif
}

void Lock::begin() {
  pinMode(LOCK_IN1, OUTPUT);
  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL == HIGH ? LOW : HIGH);

  // GPIO34 no tiene pull-up interno: el 10k externo a 3V3 es obligatorio.
  pinMode(LOCK_SENSE_PIN, INPUT);
  sense_stable = read_sense_pin();
  sense_raw = sense_stable;
  sense_millis = millis();

  Serial.print("Lock sensor: ");
  Serial.println(sense_stable ? "closed" : "open");
  Serial.println("Lock driver initialized");
}

void Lock::unlock() {
  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL);
  active = true;
  activated_millis = millis();
  Serial.println("Lock energized");
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

  digitalWrite(LOCK_IN1, LOCK_ACTIVE_LEVEL == HIGH ? LOW : HIGH);
  active = false;
  Serial.println("Lock released");
}

bool Lock::is_active() {
  return active;
}

bool Lock::is_closed() {
  return sense_stable;
}

bool Lock::sense_changed() {
  bool changed = sense_event;
  sense_event = false;
  return changed;
}
