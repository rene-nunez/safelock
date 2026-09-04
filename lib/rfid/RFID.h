#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>

class rfid_reader {
  private:
    MFRC522 mfrc522;
    byte master_uid[4];
    bool master_set;
    bool card_present;
    byte current_uid[4];

    bool compare_uids(byte *uid1, byte *uid2);
    String uid_to_string(byte *uid);

  public:
    rfid_reader();

    void begin();
    void poll();
    bool is_card_present();
    bool is_master_set();
    bool is_authorized();
    void set_master();
    String get_uid_string();
};
