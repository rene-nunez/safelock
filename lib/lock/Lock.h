#pragma once

#include <Arduino.h>

class solenoid_lock {
  private:
    bool active = false;
    unsigned long activated_millis = 0;
    bool sensor_state_initialized = false;
    bool sensor_state_reported = false;
    bool sensor_candidate_closed = false;
    bool sensor_closed = false;
    unsigned long sensor_candidate_millis = 0;

  public:
    solenoid_lock();

    void begin();
    void unlock();
    void update();
    bool is_active();
};
