#include "Device.h"
#include "pins.h"

Device::Device(): tasks(rfid, numpad, display, clock, storage, lock, indicators) {}

void Device::begin() {
  // All SPI devices share the bus: keep every CS high before initializing
  // any of them, so none is selected while the others boot.
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(RFID_SS, OUTPUT);
  digitalWrite(RFID_SS, HIGH);
  pinMode(OLED_CS, OUTPUT);
  digitalWrite(OLED_CS, HIGH);

  // Mount the MicroSD first. It shares the 3V3 rail with the OLED and the
  // reader, and the card is the most sensitive to voltage dips during init.
  storage.begin();
  lock.begin();
  clock.begin();
  indicators.begin();
  indicators.show_locked();
  numpad.begin();
  display.begin();
  display.show_lock();
  rfid.begin();
}

void Device::run() {
  tasks.run();
}
