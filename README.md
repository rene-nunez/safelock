# Safelock

## Hardware

- ESP32
- MFRC522 RFID Reader (SPI)
- SSD1306 OLED (SPI)
- MicroSD (SPI)
- 4x3 Keypad
- DS1307 RTC (I2C)
- PCF8574T Status LEDs (I2C)
- Passive Buzzer
- DRV8871 + 12V Lock, with Lock State Switch

12V needed for the DRV8871; 3.3V for the rest.

### Pinout

Pins are defined in [`firmware/include/pins.h`](firmware/include/pins.h), including the pull-ups, strapping pins and input-only notes. The microSD, MFRC522 and OLED share SPI; the DS1307 and PCF8574T share I2C.
