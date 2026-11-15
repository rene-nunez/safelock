#include <Arduino.h>
#include <Device.h>

Device device;

void setup() {
  Serial.begin(115200);
  device.begin();
}

void loop() {
  device.run();
}
