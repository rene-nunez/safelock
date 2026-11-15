#include "Clock.h"
#include "pins.h"

Clock::Clock() {}

bool Clock::begin() {
  Wire.begin(RTC_SDA, RTC_SCL);

  if (!rtc.begin()) {
    Serial.println("RTC DS1307 not found");
    ready = false;
    return false;
  }

  if (!rtc.isrunning()) {
    Serial.println("Clock stopped, setting the RTC to the compile time");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  Serial.println("RTC DS1307 initialized");
  ready = true;
  return true;
}

String Clock::timestamp() {
  if (!ready) return "";

  // Returns the current date and time as a String in ISO 8601 format ("YYYY-MM-DDThh:mm:ss").
  DateTime now = rtc.now();
  return now.timestamp(DateTime::TIMESTAMP_FULL);
}
