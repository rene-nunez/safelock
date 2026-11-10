#pragma once

#include <Arduino.h>

class solenoid_lock {
  private:
    bool active = false;
    unsigned long activated_millis = 0;

    bool sense_raw = false;
    bool sense_stable = false;
    bool sense_event = false;
    unsigned long sense_millis = 0;

    bool read_sense_pin();

  public:
    solenoid_lock();

    void begin();
    void unlock();
    void update();
    bool is_active();
    bool is_closed();
    bool sense_changed();
};
