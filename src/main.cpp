#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>

rfid_reader rfid;
numpad_input numpad;
oled_display display;
rtc_clock rtc;
sd_storage storage;
millis_tasks tasks(rfid, numpad, display, rtc, storage);

void setup() {
  Serial.begin(115200);
  rtc.begin();
  rfid.begin();
  numpad.begin();
  display.begin();
  display.show_lock();
  storage.begin();
}

void loop() {
  tasks.run();
}
