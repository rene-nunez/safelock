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

## Development

Requires Python 3.14+ and Mosquitto 2.x. The local broker listens on `127.0.0.1:1883` without TLS; TLS is only used against EMQX.

Install Mosquitto if it is not already available (Debian/Ubuntu):

```bash
sudo apt install mosquitto mosquitto-clients
```

Configure it with `allow_anonymous false` and a `password_file`, then create one user per simulated device. Both devices share the development password:

```bash
sudo mosquitto_passwd -b /etc/mosquitto/passwd sl-0001 "$SIM_PASSWORD"
sudo mosquitto_passwd -b /etc/mosquitto/passwd sl-0002 "$SIM_PASSWORD"
make mqtt-restart
```

Set up the backend environment and run the API:

```bash
make venv
make api
```

Create an account before signing in (administrator by default):

```bash
make create-user
```

You are prompted for the password and it is hashed with Argon2id. Accounts
created this way are recorded in `audit_logs`. Pass
`CLI_ARGS="--role operator"` to create an operator instead. The `users`
collection requires a unique `email`; existing accounts are rejected. Access
tokens are JWTs valid for 30 minutes (`ACCESS_TOKEN_TTL_MINUTES`); resetting a
password or deactivating the account invalidates the existing ones.

Install the frontend dependencies and start the dev server:

```bash
npm install --prefix frontend
make frontend
```

The Vite dev server proxies `/api` and `/healthz` to `127.0.0.1:8000`.
Open http://localhost:5173 and sign in with the account created above. The
session token is kept in `sessionStorage` and cleared on sign out.

The simulator publishes the MQTT contract from [`docs/protocol.md`](docs/protocol.md) for fake devices:

```bash
SIM_PASSWORD=... make simulator
make simulator SIM_ARGS="--no-interactive --devices sl-0001 --heartbeat 5"
```

When stdin is a TTY it opens a console:

```text
use <device_id>    Select the target device
scan <UID>         Send an enrollment card scan
grant [UID]        Send a granted access decision
deny [UID]         Send a denied access decision
open               Simulate a remote unlock
manual             Simulate a manual opening
offline on|off     Simulate the backend being unavailable
status             Republish the retained status
quit               Exit
```

`scan` only works after a `commands/enroll` command opens enrollment. Environment variables: `SIM_MQTT_URL`, `SIM_PASSWORD`, `SIM_DEVICES`, `SIM_HEARTBEAT`.

The dashboard map uses Leaflet with Stadia Maps (Alidade Smooth Dark). Stadia allows keyless requests from localhost; production domains authenticate through Stadia's domain authentication, so no API key is stored in the repository. Device locations are set manually with latitude and longitude.

Run the checks:

```bash
make lint
make test
make typecheck
```

## Security

Please take all of the following into consideration before attempting to implement this software:

> [!WARNING]
> **This is a prototype: its card authentication is not secure and must not be used as-is in a real deployment.**

Safelock validates cards by UID only. The device decides access on its own from the cached UID list, so on a card-only door the UID is the entire credential, and a UID can be read and cloned with cheap hardware.

MIFARE Classic offers no fix for this. Safelock does not even authenticate against the card (it just reads the UID), and the cipher MIFARE Classic does provide, Crypto-1, has been broken since 2008: keys can be recovered from a card in seconds, so the card's own authentication cannot be trusted either.

A real system would need a different design:

- Cards with proper mutual authentication (MIFARE DESFire EV2/EV3 with AES) or a secure element doing challenge-response.
- A second factor. Doors configured with `requires_pin` already add one: the PIN is validated in the backend and never stored on the device, but those doors are online-only and deny access without a connection.
