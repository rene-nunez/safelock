# Safelock

## Hardware

- ESP32
- MFRC522 RFID reader (SPI)
- SSD1306 OLED (SPI)
- microSD (SPI)
- 4x3 keypad
- DS1307 RTC (I2C)
- PCF8574T status LEDs (I2C)
- Passive buzzer
- DRV8871 + 12V lock, with lock state switch

12V needed for the DRV8871; 3.3V for the rest.

### Pinout

Pins are defined in [`firmware/include/pins.h`](firmware/include/pins.h), including the pull-ups, reset-state constraints and input-only notes. The microSD, MFRC522 and OLED share SPI; the DS1307 and PCF8574T share I2C.
