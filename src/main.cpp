#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>

rfid_reader rfid;
numpad_input numpad;
millis_tasks tasks(rfid, numpad);

void setup() {
  Serial.begin(115200);
  rfid.begin();
  numpad.begin();
}

void loop() {
  tasks.run();
}
