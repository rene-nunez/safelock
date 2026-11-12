#include "RFID.h"
#include "pins.h"

rfid_reader::rfid_reader() : mfrc522(RFID_SS, RFID_RST) {
  master_set = false;
  card_present = false;
  antenna_off_reported = false;
  memset(master_uid, 0, sizeof(master_uid));
  memset(current_uid, 0, sizeof(current_uid));
}

void rfid_reader::hard_reset() {
  pinMode(RFID_RST, OUTPUT);
  digitalWrite(RFID_RST, LOW);
  delay(20);
  digitalWrite(RFID_RST, HIGH);
  delay(100);
}

void rfid_reader::hold_reset_high() {
  // PCD_Init() deja el pin RST como INPUT si lo encuentra en alto, y el
  // NRSTPD del MFRC522 queda flotando. Con ruido en el cable el chip se
  // resetea o entra en power-down (MISO en 0xFF). Lo dejamos como salida
  // alta para que eso no ocurra.
  pinMode(RFID_RST, OUTPUT);
  digitalWrite(RFID_RST, HIGH);
}

void rfid_reader::begin() {
  SPI.begin();
  hard_reset();
  mfrc522.PCD_Init();
  hold_reset_high();
  delay(100);

  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);

  Serial.print("RFID version: 0x");
  Serial.println(version, HEX);

  if (version == 0x91 || version == 0x92) {
    Serial.println("RFID reader initialized");
  } else {
    Serial.println("RFID reader not responding");
    Serial.print("RFID pins: RST=");
    Serial.print(digitalRead(RFID_RST));
    Serial.print(" SS=");
    Serial.print(digitalRead(RFID_SS));
    Serial.print(" MISO=");
    Serial.println(digitalRead(RFID_MISO));
  }
}

bool rfid_reader::is_ready() {
  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  return version == 0x91 || version == 0x92;
}

bool rfid_reader::antenna_on() {
  return (mfrc522.PCD_ReadRegister(MFRC522::TxControlReg) & 0x03) == 0x03;
}

void rfid_reader::set_antenna(bool on) {
  // El campo de 13.56 MHz irradiado por la antena acopla al modulo
  // microSD, a sus cables y al riel de 3.3 V compartido. El firmware la
  // apaga en las ventanas donde el lector no hace polling (montaje y
  // escritura del log en SD) y la reenciende al terminar.
  if (on) {
    mfrc522.PCD_AntennaOn();
  } else {
    mfrc522.PCD_AntennaOff();
  }
}

bool rfid_reader::healthy() {
  // 0xFF en VersionReg/TxControlReg tiene los bits 0 y 1 en alto, asi
  // que hay que validar primero que el chip responde de verdad.
  if (!is_ready()) return false;
  return antenna_on();
}

void rfid_reader::log_status(const char *tag) {
  byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  byte tx_control = mfrc522.PCD_ReadRegister(MFRC522::TxControlReg);
  bool valid = (version == 0x91 || version == 0x92);

  Serial.print("[RFID] ");
  Serial.print(tag);
  Serial.print(": VersionReg=0x");
  Serial.print(version, HEX);
  Serial.print(" TxControlReg=0x");
  Serial.print(tx_control, HEX);
  Serial.print(" link=");
  Serial.print(valid ? "OK" : "NO_RESPONSE");
  Serial.print(" antenna=");

  if (!valid) {
    Serial.println("UNKNOWN");
  } else {
    Serial.println((tx_control & 0x03) == 0x03 ? "ON" : "OFF");
  }
}

void rfid_reader::recover() {
  if (healthy()) return;

  if (is_ready()) {
    Serial.println("RFID reader alive but antenna is OFF, reinitializing");
  } else {
    Serial.println("RFID reader not responding, attempting hard reset");
    log_status("recover before");
  }

  // El pulso del solenoide puede dejar el MFRC522 bloqueado o
  // reiniciado. Un reset fisico es mas fiable que solo PCD_Init.
  const uint8_t max_attempts = 2;

  for (uint8_t attempt = 1; attempt <= max_attempts; attempt++) {
    delay(100);
    hard_reset();
    mfrc522.PCD_Init();
    hold_reset_high();
    delay(100);

    if (healthy()) {
      Serial.print("RFID reader recovered on attempt ");
      Serial.println(attempt);
      return;
    }

    Serial.print("RFID recovery attempt ");
    Serial.print(attempt);
    Serial.print("/");
    Serial.print(max_attempts);
    Serial.println(" failed");
  }

  Serial.println("RFID reader still not responding");
  log_status("recover after");
}

void rfid_reader::poll() {
  card_present = false;

  if (!healthy()) {
    if (!antenna_off_reported) {
      antenna_off_reported = true;
      Serial.println("[RFID] WARNING: reader not healthy (link down or antenna OFF)");
      log_status("poll");
    }
    return;
  }

  if (antenna_off_reported) {
    antenna_off_reported = false;
    Serial.println("[RFID] reader healthy again");
  }

  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial()) return;

  card_present = true;
  memcpy(current_uid, mfrc522.uid.uidByte, 4);
  mfrc522.PICC_HaltA();
}

bool rfid_reader::is_card_present() {
  return card_present;
}

bool rfid_reader::is_master_set() {
  return master_set;
}

bool rfid_reader::is_authorized() {
  if (!master_set || !card_present) return false;
  return compare_uids(master_uid, current_uid);
}

void rfid_reader::set_master() {
  if (!card_present) return;
  memcpy(master_uid, current_uid, 4);
  master_set = true;
  Serial.print("RFID master card set: ");
  Serial.println(uid_to_string(master_uid));
}

String rfid_reader::get_uid_string() {
  if (!card_present) return "";
  return uid_to_string(current_uid);
}

bool rfid_reader::compare_uids(byte *uid1, byte *uid2) {
  for (int i = 0; i < 4; i++) {
    if (uid1[i] != uid2[i]) return false;
  }
  return true;
}

String rfid_reader::uid_to_string(byte *uid) {
  String result = "";
  for (int i = 0; i < 4; i++) {
    if (uid[i] < 0x10) result += "0";
    result += String(uid[i], HEX);
    if (i < 3) result += ":";
  }
  result.toUpperCase();
  return result;
}
