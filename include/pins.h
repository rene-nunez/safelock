#pragma once

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

// microSD SPI (comparte SCK, MISO y MOSI con el RFID)
// El modulo con regulador AMS1117 se alimenta desde 5V (VIN)
#define SD_SCK   18
#define SD_MISO  19
#define SD_MOSI  23
#define SD_CS     2

// OLED SPI (comparte SCK y SDA/MOSI con el RFID)
// RES va directo a 3V3 para liberar el GPIO 22 (SCL del RTC)
#define OLED_SCK   18
#define OLED_SDA   23
#define OLED_CS    13
#define OLED_DC    14

// I2C reservado para el clock DS1307
#define RTC_SDA 21
#define RTC_SCL 22

// Driver DRV8871 para la cerradura solenoide de 12V
// IN2 del DRV8871 va a GND y IN1 al GPIO de control
#define LOCK_IN1 12
