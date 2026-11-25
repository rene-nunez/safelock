#include "Rfid.h"
#include "pins.h"

static const uint8_t ANTENNA_MASK = 0x03;
static const uint8_t POWER_DOWN_MASK = 0x10;

// MFRC522 reports 0x91 or 0x92; anything else is a dead bus
static bool version_supported(uint8_t version) {
  return version == 0x91 || version == 0x92;
}

// NRSTPD is driven by reset_and_init(), the library must not touch it
Rfid::Rfid() : mfrc522(RFID_SS, MFRC522::UNUSED_PIN) {}

void Rfid::reset_and_init() {
  // NRSTPD is active low: 20 ms in power-down and the rising edge starts the
  // internal reset. 100 ms cover oscillator startup and bus settling.
  pinMode(RFID_RST, OUTPUT);
  digitalWrite(RFID_RST, LOW);
  delay(20);
  digitalWrite(RFID_RST, HIGH);
  delay(100);

  // The library does not manage RST, so PCD_Init() only performs a soft reset
  mfrc522.PCD_Init();

  // Keep NRSTPD driven high even if a library version reconfigures the pin;
  // a floating input lets noise reset the chip or drop it into power-down.
  pinMode(RFID_RST, OUTPUT);
  digitalWrite(RFID_RST, HIGH);
  delay(100);
}

void Rfid::begin() {
  SPI.begin();
  reset_and_init();
  log_status("begin", read_status());
}

Rfid::Status Rfid::read_status() {
  Status status;
  status.version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  status.command = mfrc522.PCD_ReadRegister(MFRC522::CommandReg);
  status.tx_control = mfrc522.PCD_ReadRegister(MFRC522::TxControlReg);
  status.responds = version_supported(status.version);

  status.antenna_on = status.responds && (status.tx_control & ANTENNA_MASK) == ANTENNA_MASK;
  return status;
}

bool Rfid::healthy() {
  Status status = read_status();
  return status.responds && status.antenna_on && (status.command & POWER_DOWN_MASK) == 0;
}

bool Rfid::wait_for_healthy() {
  // The register write is accepted while the chip is still settling; confirm
  // after the oscillator and the antenna drivers have had time to come up.
  delay(50);
  return healthy();
}

void Rfid::log_status(const char *event, const Status &status) {
  if (!status.responds) {
    Serial.printf(
      "RFID %s: no response (version=0x%02X, command=0x%02X, tx_control=0x%02X)\n",
      event,
      static_cast<unsigned>(status.version),
      static_cast<unsigned>(status.command),
      static_cast<unsigned>(status.tx_control)
    );

    return;
  }

  Serial.printf(
    "RFID %s: version=0x%02X command=0x%02X tx_control=0x%02X antenna=%s power_down=%s\n",
    event,
    static_cast<unsigned>(status.version),
    static_cast<unsigned>(status.command),
    static_cast<unsigned>(status.tx_control),
    status.antenna_on ? "on" : "off",
    (status.command & POWER_DOWN_MASK) ? "yes" : "no"
  );
}

bool Rfid::recover() {
  Status status = read_status();
  if (status.responds && status.antenna_on && (status.command & POWER_DOWN_MASK) == 0) return true;

  log_status("recover before", status);

  // A software-only re-enable is enough only while the chip is awake. A coil
  // pulse can leave it reset or in power-down, where the SPI write is ignored.
  if (status.responds && (status.command & POWER_DOWN_MASK) == 0) {
    mfrc522.PCD_AntennaOn();

    if (wait_for_healthy()) {
      Serial.println("RFID recover: antenna re-enabled");
      return true;
    }
  }

  // The solenoid pulse can leave the MFRC522 locked or reset,
  // a physical reset is more reliable than PCD_Init() alone.
  const uint8_t max_attempts = 2;

  for (uint8_t attempt = 1; attempt <= max_attempts; attempt++) {
    delay(100);
    reset_and_init();

    if (wait_for_healthy()) {
      Serial.printf(
        "RFID recover: ok on attempt %u/%u\n",
        static_cast<unsigned>(attempt),
        static_cast<unsigned>(max_attempts)
      );

      return true;
    }
  }

  log_status("recover failed", read_status());
  return false;
}

Rfid::ScanResult Rfid::poll() {
  if (!healthy()) return UNHEALTHY;

  if (!mfrc522.PICC_IsNewCardPresent()) return NO_CARD;
  if (!mfrc522.PICC_ReadCardSerial()) return NO_CARD;

  uid.length = mfrc522.uid.size;
  if (uid.length > sizeof(uid.bytes)) uid.length = sizeof(uid.bytes);
  memcpy(uid.bytes, mfrc522.uid.uidByte, uid.length);

  mfrc522.PICC_HaltA();
  return CARD;
}

const CardUid &Rfid::last_uid() const {
  return uid;
}
