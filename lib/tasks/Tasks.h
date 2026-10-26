#pragma once

#include <Arduino.h>
#include "RFID.h"
#include "Numpad.h"

#define RFID_POLL_INTERVAL 200
#define NUMPAD_POLL_INTERVAL 20

class millis_tasks {
  private:
    rfid_reader &rfid;
    numpad_input &numpad;

    unsigned long previous_rfid_millis = 0;
    unsigned long previous_numpad_millis = 0;
    unsigned long current_millis = 0;

    void run_rfid_task();
    void run_numpad_task();

  public:
    millis_tasks(rfid_reader &reader, numpad_input &pad);
    void run();
};
