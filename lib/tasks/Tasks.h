#pragma once

#include <Arduino.h>
#include "RFID.h"
#include "Numpad.h"
#include "Display.h"
#include "Clock.h"
#include "lock_config.h"

#define RFID_POLL_INTERVAL 200
#define NUMPAD_POLL_INTERVAL 20

#define LOCK_SPLASH_MS     1500
#define SUCCESS_HOLD_MS    2000
#define ERROR_BLINK_MS      250
#define ERROR_DURATION_MS  2500

class millis_tasks {
  private:
    enum lock_state { SPLASH, ENTERING, SUCCESS, ERROR };

    rfid_reader &rfid;
    numpad_input &numpad;
    oled_display &display;
    rtc_clock &rtc;

    lock_state state = SPLASH;
    char entered_password[PASSWORD_LENGTH + 1] = "";
    uint8_t entered_digits = 0;
    bool error_icon_visible = true;

    unsigned long previous_rfid_millis = 0;
    unsigned long previous_numpad_millis = 0;
    unsigned long state_millis = 0;
    unsigned long last_blink_millis = 0;
    unsigned long current_millis = 0;

    void run_rfid_task();
    void run_numpad_task();
    void run_display_task();

    void add_digit(char digit);
    void grant_access();
    void deny_access();

  public:
    millis_tasks(
      rfid_reader &reader,
      numpad_input &pad,
      oled_display &screen,
      rtc_clock &rtc_device
    );
    void run();
};
