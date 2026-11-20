#pragma once

#include <Arduino.h>

#include "config.h"

class Lock {
  private:
    bool active = false;
    unsigned long activated_millis = 0;

    bool sense_raw = false;
    bool sense_stable = false;
    bool sense_event = false;
    unsigned long sense_millis = 0;

    bool has_command = false;
    unsigned long command_millis = 0;
    bool manual_open = false;

    uint16_t unlock_ms = LOCK_OPEN_MS;

    bool read_sense_pin() const;
    void set_coil(bool energized);

  public:
    void begin();
    void set_unlock_ms(uint16_t ms);
    void unlock();
    void update();
    bool is_active() const;
    bool is_closed() const;
    bool sense_changed();
    bool take_manual_open();
};
