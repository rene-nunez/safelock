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

Please take all of the following into consideration before attempting to implement this software:

> [!WARNING]
> **This is a prototype: its card authentication is not secure and must not be used as-is in a real deployment.**

Safelock validates cards by UID only. The device decides access on its own from the cached UID list, so on a card-only door the UID is the entire credential, and a UID can be read and cloned with cheap hardware.

MIFARE Classic offers no fix for this. Safelock does not even authenticate against the card (it just reads the UID), and the cipher MIFARE Classic does provide, Crypto-1, has been broken since 2008: keys can be recovered from a card in seconds, so the card's own authentication cannot be trusted either.

A real system would need a different design:

- Cards with proper mutual authentication (MIFARE DESFire EV2/EV3 with AES) or a secure element doing challenge-response.
- A second factor. Doors configured with `requires_pin` already add one: the PIN is validated in the backend and never stored on the device, but those doors are online-only and deny access without a connection.
