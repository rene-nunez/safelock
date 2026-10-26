#include <Arduino.h>
#include <Tasks.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include "pins.h"

rfid_reader rfid;
numpad_input numpad;
oled_display display;
rtc_clock rtc;
sd_storage storage;
millis_tasks tasks(rfid, numpad, display, rtc, storage);

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

  rtc.begin();
  rfid.begin();
  numpad.begin();
  display.begin();
  display.show_lock();
}

void loop() {
  tasks.run();
}
