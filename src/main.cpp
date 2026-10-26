#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include <Lock.h>
#include <pins.h>

rfid_reader rfid;
numpad_input numpad;
oled_display display;
rtc_clock rtc;
sd_storage storage;
solenoid_lock lock;
millis_tasks tasks(rfid, numpad, display, rtc, storage, lock);

void setup() {
  Serial.begin(115200);

  // Mantiene todos los dispositivos SPI deseleccionados durante el arranque.
  pinMode(OLED_CS, OUTPUT);
  digitalWrite(OLED_CS, HIGH);
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(RFID_SS, OUTPUT);
  digitalWrite(RFID_SS, HIGH);

  lock.begin();
  rtc.begin();
  display.begin();
  display.show_lock();
  rfid.begin();
  numpad.begin();
}

void loop() {
  tasks.run();
}
