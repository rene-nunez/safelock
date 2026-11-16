#pragma once

// Shared SPI bus: SCK 18, MOSI 23, MISO 19

// MFRC522
#define RFID_SS   5 // 10k pull-up to 3V3
#define RFID_RST 27

// 4x3 keypad
#define NUMPAD_ROW_1 16
#define NUMPAD_ROW_2 26
#define NUMPAD_ROW_3 25
#define NUMPAD_ROW_4 32

#define NUMPAD_COL_1 17
#define NUMPAD_COL_2  4 // LOW at boot
#define NUMPAD_COL_3 33

// microSD
#define SD_CS 2 // 10k pull-up to 3V3

// SSD1306 OLED, RES pin tied to 3V3
#define OLED_CS 13
#define OLED_DC 14

// I2C: DS1307 + PCF8574T
#define RTC_SDA 21
#define RTC_SCL 22

// PCF8574T LEDs
#define PCF8574_RED_BIT   0
#define PCF8574_GREEN_BIT 1

// Buzzer
#define BUZZER_PIN 15

// DRV8871, IN2 pin tied to GND
#define LOCK_IN1 12 // LOW at boot

// Lock dry contacts, the another wire goes to GND
#define LOCK_SENSE_PIN 34 // external 10k pull-up to 3V3
