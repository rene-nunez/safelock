#pragma once

#include <Arduino.h>
#include <RTClib.h>

class Clock {
  private:
    RTC_DS1307 rtc;
    bool ready = false;

  public:
    bool begin();
    String timestamp();
};
