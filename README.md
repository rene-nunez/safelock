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

### Configuration

[`firmware/include/config.h`](firmware/include/config.h) holds everything you tune: active levels and hardware variants (LED polarity, passive buzzer, lock and sense polarity), timings (unlock pulse, sensor debounce) and the temporary PIN and UID allowlist that will be replaced by the backend. `pins.h` is only the board map.
