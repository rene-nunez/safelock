#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>

rfid_reader rfid;
numpad_input numpad;
oled_display display;
rtc_clock rtc;
millis_tasks tasks(rfid, numpad, display, rtc);

void setup() {
  Serial.begin(115200);
  rtc.begin();
  rfid.begin();
  numpad.begin();
  display.begin();
  display.show_lock();
}

void loop() {
  tasks.run();
}
