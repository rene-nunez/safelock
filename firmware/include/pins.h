#pragma once

// MFRC522: pull-up obligatorio de 10k de RST a 3V3. El modulo no lleva
// capacitores; el firmware mantiene RST como salida alta tras PCD_Init().
#define RFID_MOSI 23
#define RFID_MISO 19
#define RFID_SCK  18
#define RFID_SS    5
#define RFID_RST  27

#define NUMPAD_ROW_1 16
#define NUMPAD_ROW_2 26
#define NUMPAD_ROW_3 25
#define NUMPAD_ROW_4 32

#define NUMPAD_COL_1 17
#define NUMPAD_COL_2  4
#define NUMPAD_COL_3 33

// microSD SPI (misma asignacion para ambos modulos)
// Modulo v474: VCC -> 3V3 (NO alimentar con 5V)
// Modulo anterior con AMS1117: VCC -> 5V (VIN)
// CS -> GPIO2, CLK -> GPIO18, MOSI -> GPIO23, MISO -> GPIO19
// GPIO2 es strapping: agregar pull-up de 10k de CS a 3V3.
#define SD_SCK   18
#define SD_MISO  19
#define SD_MOSI  23
#define SD_CS     2

// OLED SPI (comparte SCK y SDA/MOSI con el RFID)
// RES va directo a 3V3. NO conectar RES a GPIO15: ese pin es del buzzer.
#define OLED_SCK   18
#define OLED_SDA   23
#define OLED_CS    13
#define OLED_DC    14

// I2C compartido: clock DS1307 y expansor PCF8574T
#define RTC_SDA 21
#define RTC_SCL 22

// PCF8574T para LEDs de estado.
// VCC -> 3V3, GND -> GND, SDA -> GPIO21, SCL -> GPIO22.
// P0 -> LED rojo, P1 -> LED verde. Ambos activos en bajo.
#define PCF8574_RED_BIT 0
#define PCF8574_GREEN_BIT 1
#define PCF8574_LED_ACTIVE_LOW 1

// Buzzer pasivo en GPIO15 mediante PWM (LEDC).
// Si el buzzer consume mas de 20 mA, usar transistor NPN y pull-down
// de 10k en la base para que no suene al arrancar.
#define BUZZER_PIN 15
#define BUZZER_LEDC_CHANNEL 0
#define BUZZER_PASSIVE 1

// Driver DRV8871 para la cerradura solenoide de 12V
// IN2 del DRV8871 va a GND y IN1 al GPIO de control
#define LOCK_IN1 12

// Sensor de estado de la cerradura (contacto seco del solenoide).
// Un cable del sensor va a GND y el otro a GPIO34.
// GPIO34 es solo entrada y NO tiene pull-up interno:
// agregar 10k entre GPIO34 y 3V3, y 100nF de GPIO34 a GND.
//
// LOCK_SENSE_ACTIVE_LOW 1: el contacto cierra a GND cuando la cerradura
// esta cerrada. Cambiar a 0 si el sensor trabaja al reves.
#define LOCK_SENSE_PIN 34
#define LOCK_SENSE_ACTIVE_LOW 1
#define LOCK_SENSE_DEBOUNCE_MS 50
