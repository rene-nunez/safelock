#include "Clock.h"
#include "pins.h"

rtc_clock::rtc_clock() {}

bool rtc_clock::begin() {
  Wire.begin(RTC_SDA, RTC_SCL);

  if (!rtc.begin()) {
    Serial.println("RTC DS1307 not found");
    ready = false;
    return false;
  }

  if (!rtc.isrunning()) {
    Serial.println("RTC stopped, setting compile time");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  ready = true;
  Serial.println("RTC DS1307 initialized");
  return true;
}

String rtc_clock::timestamp() {
  if (!ready) return "";

  DateTime now = rtc.now();
  return now.timestamp(DateTime::TIMESTAMP_FULL);
}
