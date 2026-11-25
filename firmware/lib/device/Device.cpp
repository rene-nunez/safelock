#include "Device.h"
#include "pins.h"

#include <time.h>

Device::Device()
  : provisioning(settings),
    acl(storage),
    outbox(storage),
    mqtt(settings, net, clock, lock, acl, outbox),
    tasks(rfid, numpad, display, clock, storage, lock, indicators, acl, mqtt) {}

void Device::begin() {
  // Serial is up before begin(): the installer provisions the device over USB.
  settings.begin();
  provisioning.begin();
  if (!settings.is_provisioned()) {
    Serial.println("Waiting for provisioning over serial");
    Serial.println("Type 'help' for commands");
    while (!settings.is_provisioned()) {
      provisioning.poll();
      delay(20);
    }
  }
  Serial.print("Device ID: ");
  Serial.println(settings.get_device_id());

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
  acl.begin();
  lock.set_unlock_ms(acl.get_unlock_ms());
  outbox.begin();
  net.begin(settings.get_wifi_ssid(), settings.get_wifi_password());
  if (net.time_valid()) clock.sync_from_epoch(time(nullptr));
  mqtt.begin();
  mqtt.set_command_handler(tasks);

  indicators.begin();
  indicators.show_locked();
  numpad.begin();

  display.begin();
  display.show_logo();
  delay(1500);
  display.show_lock();
  rfid.begin();
}

void Device::run() {
  provisioning.poll();
  net.update();
  mqtt.update();
  tasks.run();
}
