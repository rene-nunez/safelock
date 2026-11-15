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
    bool antenna_off_reported;
    byte current_uid[4];

    bool compare_uids(byte *uid1, byte *uid2);
    String uid_to_string(byte *uid);
    bool is_ready();
    bool antenna_on();
    void hard_reset();
    void hold_reset_high();
    void log_status(const char *tag);

  public:
    rfid_reader();

    void begin();
    void recover();
    void poll();
    bool healthy();
    bool is_card_present();
    bool is_master_set();
    bool is_authorized();
    void set_master();
    String get_uid_string();
};
