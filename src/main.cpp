#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>

rfid_reader rfid;
millis_tasks tasks(rfid);

void setup() {
  Serial.begin(115200);
  rfid.begin();
}

void loop() {
  tasks.run();
}
