# Safelock

## Hardware

- ESP32
- MFRC522 RFID reader and card (SPI)
- SSD1306 OLED (SPI)
- microSD (SPI; v474 module is 3.3V, AMS1117 modules take 5V)
- 4x3 keypad
- DS1307 RTC (I2C)
- PCF8574T with 2 LEDs (I2C)
- Passive or active buzzer
- DRV8871 + 12V electromagnetic lock

12V for the DRV8871 and the lock; 3.3V from the ESP32 for the rest.

### Pinout

[`firmware/include/pins.h`](firmware/include/pins.h) maps every GPIO pin and PCF8574T bit, with its boot-level and pull-up constraints listed alongside.

MFRC522, microSD, and SSD1306 OLED share SPI; the DS1307 RTC and PCF8574T share I2C.

### Configuration

Active levels, hardware variants, and lock timings are configured in [`firmware/include/config.h`](firmware/include/config.h). This covers the PCF8574 LED polarity, buzzer type, DRV8871 coil level, pulse length, sensor debounce, etc.

## Security

> [!WARNING]
> **MIFARE Classic only validates the card UID, which is clonable.**
> A UID is not a secret: it can be read and copied with cheap hardware, so card-only
> validation is not a strong authentication factor. This is a hardware limitation of
> MIFARE Classic and is acceptable only for low-risk doors. For anything that matters,
> use cards with encrypted authentication (MIFARE DESFire EV2/EV3) or a secure element,
> and keep a PIN as a second factor on the doors that need it.
