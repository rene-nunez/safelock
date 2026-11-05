#pragma once

#include <Arduino.h>

class status_indicators {
  private:
    uint8_t address = 0;
    uint8_t pcf_state = 0xFF;
    bool ready = false;

    uint16_t beep_freq = 0;
    uint16_t beep_on_ms = 0;
    uint16_t beep_off_ms = 0;
    uint8_t beep_remaining = 0;
    bool beep_active = false;
    bool beep_on = false;
    unsigned long beep_phase_end = 0;

    uint8_t find_address();
    void write_pcf();
    void set_leds(bool red, bool green);
    void start_beep(uint16_t freq, uint16_t on_ms, uint16_t off_ms, uint8_t repeats);
    void buzzer_on();
    void buzzer_off();

  public:
    status_indicators();

    bool begin();
    void show_locked();
    void show_unlocked();
    void show_denied();
    void beep_ok();
    void beep_error();
    void update();
};
