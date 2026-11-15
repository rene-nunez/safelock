#include "Clock.h"
#include "pins.h"

bool Clock::begin() {
  Wire.begin(RTC_SDA, RTC_SCL);

  if (!rtc.begin()) {
    Serial.println("Clock begin: failed (DS1307 not found)");
    ready = false;
    return false;
  }

  if (!rtc.isrunning()) {
    Serial.println("Clock begin: no valid time, set to compile time");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  Serial.println("Clock begin: ok");
  ready = true;
  return true;
}

String Clock::timestamp() {
  if (!ready) return "";

  // Returns the current date and time as a String in ISO 8601 format ("YYYY-MM-DDThh:mm:ss").
  DateTime now = rtc.now();
  return now.timestamp(DateTime::TIMESTAMP_FULL);
}
