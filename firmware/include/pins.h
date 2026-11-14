#pragma once

// Shared SPI bus: SCK 18, MOSI 23, MISO 19

// MFRC522
#define RFID_MISO 19
#define RFID_SS    5 // strapping, 10k pull-up to 3V3
#define RFID_RST  27 // 10k pull-up to 3V3 required

// 4x3 Keypad
#define NUMPAD_ROW_1 16
#define NUMPAD_ROW_2 26
#define NUMPAD_ROW_3 25
#define NUMPAD_ROW_4 32

#define NUMPAD_COL_1 17
#define NUMPAD_COL_2  4 // strapping
#define NUMPAD_COL_3 33

// MicroSD (module v474 needs 3V3, and module AMS1117 5V)
#define SD_MISO 19
#define SD_MOSI 23
#define SD_SCK  18
#define SD_CS    2 // strapping, 10k pull-up to 3V3

// SSD1306 OLED
#define OLED_CS 13
#define OLED_DC 14 // display RES goes straight to 3V3

// I2C: DS1307 RTC + PCF8574T Expander
#define RTC_SDA 21
#define RTC_SCL 22

// PCF8574T status LEDs, active low
#define PCF8574_RED_BIT 0
#define PCF8574_GREEN_BIT 1
#define PCF8574_LED_ACTIVE_LOW 1

// Passive Buzzer driven by LEDC
#define BUZZER_PIN 15 // strapping, 10k pull-down on the transistor base
#define BUZZER_LEDC_CHANNEL 0
#define BUZZER_PASSIVE 1

// DRV8871 Lock Driver, IN2 tied to GND
#define LOCK_IN1 12 // strapping, must be low at boot

// Lock State Switch (dry contact to GND)
#define LOCK_SENSE_PIN 34 // input-only, external 10k pull-up required
#define LOCK_SENSE_ACTIVE_LOW 1
#define LOCK_SENSE_DEBOUNCE_MS 50
