#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include <Lock.h>
#include <Indicators.h>
#include <pins.h>

rfid_reader rfid;
numpad_input numpad;
oled_display display;
rtc_clock rtc;
sd_storage storage;
solenoid_lock lock;
status_indicators indicators;
millis_tasks tasks(rfid, numpad, display, rtc, storage, lock, indicators);

void setup() {
  Serial.begin(115200);

  // Todos los dispositivos comparten el bus SPI: deja sus CS en HIGH
  // antes de inicializar cualquiera para que ninguno quede seleccionado.
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(RFID_SS, OUTPUT);
  digitalWrite(RFID_SS, HIGH);
  pinMode(OLED_CS, OUTPUT);
  digitalWrite(OLED_CS, HIGH);

  // La microSD se monta antes que cualquier otro periferico. Comparte el
  // riel de 3V3 con la OLED y el RFID, y la tarjeta es la mas sensible a
  // las caidas de tension al inicializar, asi que se le da el riel solo.
  storage.begin();

  lock.begin();
  rtc.begin();
  indicators.begin();
  indicators.show_locked();
  numpad.begin();
  display.begin();
  display.show_lock();
  rfid.begin();
}

void loop() {
  tasks.run();
}
