#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>

#include "card_uid.h"

class Rfid {
  public:
    enum ScanResult { NO_CARD, CARD, UNHEALTHY };

    Rfid();

    void begin();
    bool recover();
    bool healthy();
    ScanResult poll();
    const CardUid &last_uid() const;

  private:
    struct Status {
      uint8_t version;
      uint8_t command;
      uint8_t tx_control;
      bool responds;
      bool antenna_on;
    };

    MFRC522 mfrc522;
    CardUid uid;

    void reset_and_init();
    Status read_status();
    bool wait_for_healthy();
    void log_status(const char *event, const Status &status);
};
