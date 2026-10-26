#pragma once

#include <Arduino.h>

class solenoid_lock {
  private:
    bool active = false;
    unsigned long activated_millis = 0;

  public:
    solenoid_lock();

    void begin();
    void unlock();
    void update();
    bool is_active();
};
