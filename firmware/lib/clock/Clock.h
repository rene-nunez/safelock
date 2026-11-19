#pragma once

#include <Arduino.h>
#include <RTClib.h>
#include <time.h>

class Clock {
  private:
    RTC_DS1307 rtc;
    bool ready = false;

  public:
    bool begin();
    String timestamp();
    bool is_valid();
    void sync_from_epoch(time_t epoch);
};
