#include <Arduino.h>
#include <Tasks.h>

millis_tasks tasks;

void setup() {
  Serial.begin(115200);
}

void loop() {
  tasks.run();
}
