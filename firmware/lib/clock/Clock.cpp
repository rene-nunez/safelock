#include "Clock.h"
#include "pins.h"

#include <time.h>

bool Clock::begin() {
  Wire.begin(RTC_SDA, RTC_SCL);

  if (!rtc.begin()) {
    Serial.println("Clock begin: failed (DS1307 not found)");
    ready = false;
    return false;
  }

  if (!rtc.isrunning()) {
    // Never seed a stopped RTC with the compile time: that timestamp is not
    // trustworthy and would silently enable validity checks with a wrong date.
    Serial.println("Clock begin: RTC not running, waiting for network time");
  }

  Serial.println("Clock begin: ok");
  ready = true;
  return true;
}

String Clock::timestamp() {
  if (ready && rtc.isrunning()) {
    return rtc.now().timestamp(DateTime::TIMESTAMP_FULL);
  }

  // Network time is the fallback while the DS1307 is unavailable or stopped.
  const time_t epoch = time(nullptr);
  if (epoch < 1700000000) return "";

  struct tm utc;
  gmtime_r(&epoch, &utc);
  char buffer[20];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S", &utc);
  return String(buffer);
}

bool Clock::is_valid() { return ready && rtc.isrunning(); }

void Clock::sync_from_epoch(time_t epoch) {
  if (!ready) return;
  if (epoch <= 0) return;

  if (!rtc.isrunning()) {
    rtc.adjust(DateTime(epoch));
    Serial.println("Clock synced from network time");
    return;
  }

  const int64_t drift =
    static_cast<int64_t>(epoch) - static_cast<int64_t>(rtc.now().unixtime());
  if (drift >= -5 && drift <= 5) return;

  rtc.adjust(DateTime(epoch));
  Serial.println("Clock synced from network time");
}
