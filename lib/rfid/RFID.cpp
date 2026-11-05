#include "RFID.h"
#include "pins.h"

rfid_reader::rfid_reader() : mfrc522(RFID_SS, RFID_RST) {
  master_set = false;
  card_present = false;
  memset(master_uid, 0, sizeof(master_uid));
  memset(current_uid, 0, sizeof(current_uid));
}

void rfid_reader::hard_reset() {
  pinMode(RFID_RST, OUTPUT);
  digitalWrite(RFID_RST, LOW);
  delay(10);
  digitalWrite(RFID_RST, HIGH);
  delay(50);
}

void rfid_reader::begin() {
  SPI.begin();
  hard_reset();
  mfrc522.PCD_Init();
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

void rfid_reader::recover() {
  // Si el MFRC522 sigue respondiendo, no lo reinicies: hacerlo en
  // cada acceso puede hacer que se pierdan lecturas.
  if (is_ready()) return;

  // El pulso del solenoide puede dejar el MFRC522 bloqueado o
  // reiniciado. Un reset fisico es mas fiable que solo PCD_Init.
  delay(100);
  hard_reset();
  mfrc522.PCD_Init();
  delay(50);

  if (is_ready()) {
    Serial.println("RFID reader recovered");
  } else {
    Serial.println("RFID reader still not responding");
  }
}

void rfid_reader::poll() {
  card_present = false;

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
