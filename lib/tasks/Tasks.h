#pragma once

#include <Arduino.h>
#include "RFID.h"

#define RFID_POLL_INTERVAL 200

class millis_tasks {
  private:
    rfid_reader &rfid;

    unsigned long previous_rfid_millis = 0;
    unsigned long current_millis = 0;

    void run_rfid_task();

  public:
    millis_tasks(rfid_reader &reader);
    void run();
};
