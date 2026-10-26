#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>

rfid_reader rfid;
numpad_input numpad;
oled_display display;
millis_tasks tasks(rfid, numpad, display);

void setup() {
  Serial.begin(115200);
  rfid.begin();
  numpad.begin();
  display.begin();
  display.show_lock();
}

void loop() {
  tasks.run();
}
