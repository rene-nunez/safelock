#include "Indicators.h"
#include "pins.h"
#include "config.h"

#include <Wire.h>

namespace {

constexpr unsigned long PCF_RETRY_MS = 500;

} // namespace

uint8_t Indicators::find_address() {
  // PCF8574T
  for (uint8_t addr = 0x20; addr <= 0x27; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) return addr;
  }

  // PCF8574AT
  for (uint8_t addr = 0x38; addr <= 0x3F; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) return addr;
  }

  return 0;
}

bool Indicators::begin() {
  // The RTC already brings up Wire, but doing it here lets this module work even when the RTC is missing
  Wire.begin(RTC_SDA, RTC_SCL);

  address = find_address();

  if (address == 0) {
    ready = false;
    Serial.println("Indicators begin: failed (PCF8574 not found)");
  } else {
    ready = true;
    pcf_state = 0xFF;
    pcf_desired = 0xFF;
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

bool Indicators::write_pcf() {
  if (!ready) return true;

  Wire.beginTransmission(address);
  Wire.write(pcf_desired);
  if (Wire.endTransmission() != 0) {
    pcf_pending = true;
    return false;
  }

  pcf_state = pcf_desired;
  pcf_pending = false;
  return true;
}

void Indicators::set_leds(bool red, bool green) {
  const uint8_t mask = (1 << PCF8574_RED_BIT) | (1 << PCF8574_GREEN_BIT);
  uint8_t next = pcf_desired & ~mask;

  if (red) next |= 1 << PCF8574_RED_BIT;
  if (green) next |= 1 << PCF8574_GREEN_BIT;

  // The expander sinks current, so a LED turns on with a LOW pin
#if PCF8574_LED_ACTIVE_LOW
  next ^= mask;
#endif

  pcf_desired = next;
  if (next == pcf_state) {
    pcf_pending = false;
    return;
  }

  pcf_pending = true;
  write_pcf();
}

void Indicators::show_locked() {
  set_leds(true, false);
}

void Indicators::show_unlocked() {
  set_leds(false, true);
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

void Indicators::start_beep(uint16_t freq, uint16_t on_ms, uint16_t off_ms, uint8_t repeats, uint16_t alternate_freq) {
  if (repeats == 0) return;

  beep_freq = freq;
  beep_primary_freq = freq;
  beep_alternate_freq = alternate_freq;
  beep_on_ms = on_ms;
  beep_off_ms = off_ms;
  beep_remaining = repeats;
  beep_active = true;
  beep_on = true;
  beep_alternate_next = true;

  buzzer_on();
  beep_phase_end = millis() + on_ms;
}

void Indicators::beep_ok() {
  start_beep(2000, 80, 0, 1);
}

void Indicators::beep_error() {
  start_beep(800, 120, 80, 2);
}

void Indicators::beep_alert() {
  start_beep(700, 130, 70, 5, 1400);
}

void Indicators::update() {
  unsigned long now = millis();

  // A failed I2C write leaves the cached state stale; retry until the
  // expander acknowledges instead of assuming the LEDs changed.
  if (pcf_pending && static_cast<int32_t>(now - pcf_retry_at) >= 0) {
    pcf_retry_at = now + PCF_RETRY_MS;
    write_pcf();
  }

  if (!beep_active) return;

  if (static_cast<int32_t>(now - beep_phase_end) < 0) return;

  beep_on = !beep_on;

  if (beep_on) {
    if (beep_alternate_freq != 0) {
      beep_freq = beep_alternate_next ? beep_alternate_freq : beep_primary_freq;
      beep_alternate_next = !beep_alternate_next;
    }

    buzzer_on();
    beep_phase_end = now + beep_on_ms;
    return;
  }

  buzzer_off();
  if (--beep_remaining == 0) beep_active = false;
  beep_phase_end = now + beep_off_ms;
}
