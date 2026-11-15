#include "Indicators.h"
#include "pins.h"

#include <Wire.h>

Indicators::Indicators() {}

uint8_t Indicators::find_address() {
  // PCF8574T: 0x20-0x27. PCF8574AT: 0x38-0x3F.
  for (uint8_t addr = 0x20; addr <= 0x27; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) return addr;
  }

  for (uint8_t addr = 0x38; addr <= 0x3F; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) return addr;
  }

  return 0;
}

bool Indicators::begin() {
  // El RTC ya inicializa Wire, pero repetirlo permite usar este modulo
  // aunque el RTC no este presente.
  Wire.begin(RTC_SDA, RTC_SCL);

  address = find_address();

  if (address == 0) {
    ready = false;
    Serial.println("Indicators begin: failed (PCF8574 not found)");
  } else {
    ready = true;
    pcf_state = 0xFF;
    write_pcf();

    Serial.printf(
      "Indicators begin: ok (0x%02X)\n",
      static_cast<unsigned>(address)
    );
  }

#if BUZZER_PASSIVE
  ledcSetup(BUZZER_LEDC_CHANNEL, 2000, 10);
  ledcAttachPin(BUZZER_PIN, BUZZER_LEDC_CHANNEL);
  ledcWrite(BUZZER_LEDC_CHANNEL, 0);
#else
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
#endif

  return ready;
}

void Indicators::write_pcf() {
  if (!ready) return;

  Wire.beginTransmission(address);
  Wire.write(pcf_state);
  Wire.endTransmission();
}

void Indicators::set_leds(bool red, bool green) {
  uint8_t next = pcf_state;

#if PCF8574_LED_ACTIVE_LOW
  if (red) {
    next &= ~(1 << PCF8574_RED_BIT);
  } else {
    next |= (1 << PCF8574_RED_BIT);
  }

  if (green) {
    next &= ~(1 << PCF8574_GREEN_BIT);
  } else {
    next |= (1 << PCF8574_GREEN_BIT);
  }
#else
  if (red) {
    next |= (1 << PCF8574_RED_BIT);
  } else {
    next &= ~(1 << PCF8574_RED_BIT);
  }

  if (green) {
    next |= (1 << PCF8574_GREEN_BIT);
  } else {
    next &= ~(1 << PCF8574_GREEN_BIT);
  }
#endif

  if (next == pcf_state) return;

  pcf_state = next;
  write_pcf();
}

void Indicators::show_locked() {
  set_leds(true, false);
}

void Indicators::show_unlocked() {
  set_leds(false, true);
}

void Indicators::show_denied() {
  set_leds(true, false);
}

void Indicators::buzzer_on() {
#if BUZZER_PASSIVE
  ledcWriteTone(BUZZER_LEDC_CHANNEL, beep_freq);
  ledcWrite(BUZZER_LEDC_CHANNEL, 512);
#else
  digitalWrite(BUZZER_PIN, HIGH);
#endif
}

void Indicators::buzzer_off() {
#if BUZZER_PASSIVE
  ledcWrite(BUZZER_LEDC_CHANNEL, 0);
#else
  digitalWrite(BUZZER_PIN, LOW);
#endif
}

void Indicators::start_beep(
  uint16_t freq,
  uint16_t on_ms,
  uint16_t off_ms,
  uint8_t repeats
) {
  if (repeats == 0) return;

  beep_freq = freq;
  beep_on_ms = on_ms;
  beep_off_ms = off_ms;
  beep_remaining = repeats;
  beep_active = true;
  beep_on = true;

  buzzer_on();
  beep_phase_end = millis() + on_ms;
}

void Indicators::beep_ok() {
  start_beep(2000, 80, 0, 1);
}

void Indicators::beep_error() {
  start_beep(800, 120, 80, 2);
}

void Indicators::update() {
  if (!beep_active) return;

  unsigned long now = millis();
  if ((int32_t)(now - beep_phase_end) < 0) return;

  if (beep_on) {
    buzzer_off();
    beep_on = false;
    beep_remaining--;

    if (beep_remaining == 0) {
      beep_active = false;
      return;
    }

    beep_phase_end = now + beep_off_ms;
    return;
  }

  buzzer_on();
  beep_on = true;
  beep_phase_end = now + beep_on_ms;
}
