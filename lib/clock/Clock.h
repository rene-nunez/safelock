#pragma once

#include <Arduino.h>
#include <RTClib.h>

class rtc_clock {
  private:
    RTC_DS1307 rtc;
    bool ready = false;

  public:
    rtc_clock();

    bool begin();
    String timestamp();
};
