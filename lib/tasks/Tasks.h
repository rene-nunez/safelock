#pragma once

#include <Arduino.h>
#include "RFID.h"
#include "Numpad.h"
#include "Display.h"
#include "Clock.h"
#include "Storage.h"
#include "Lock.h"
#include "lock_config.h"

#define RFID_POLL_INTERVAL 200
#define NUMPAD_POLL_INTERVAL 20

#define LOCK_SPLASH_MS     1500
#define SUCCESS_HOLD_MS    2000
#define ERROR_BLINK_MS      250
#define ERROR_DURATION_MS  2500
#define SD_RETRY_MS        1000
#define SD_MAX_ATTEMPTS       10

class millis_tasks {
  private:
    enum lock_state { WAIT_SD, ENTERING, SUCCESS, LOGGING, ERROR };

    rfid_reader &rfid;
    numpad_input &numpad;
    oled_display &display;
    rtc_clock &rtc;
    sd_storage &storage;
    solenoid_lock &lock;

    lock_state state = WAIT_SD;
    char entered_password[PASSWORD_LENGTH + 1] = "";
    uint8_t entered_digits = 0;
    bool error_icon_visible = true;

    uint8_t sd_init_attempts = 0;
    uint8_t sd_log_attempts = 0;

    String pending_date;
    String pending_time;
    const char *pending_method = "";

    unsigned long previous_rfid_millis = 0;
    unsigned long previous_numpad_millis = 0;
    unsigned long state_millis = 0;
    unsigned long last_blink_millis = 0;
    unsigned long last_sd_attempt = 0;
    unsigned long current_millis = 0;

    void run_storage_task();
    void run_rfid_task();
    void run_numpad_task();
    void run_lock_task();
    void run_display_task();

    void add_digit(char digit);
    void grant_access(const char *method);
    void deny_access();
    bool try_log_access();
    void finish_log_without_write();

  public:
    millis_tasks(
      rfid_reader &reader,
      numpad_input &pad,
      oled_display &screen,
      rtc_clock &rtc_device,
      sd_storage &sd,
      solenoid_lock &lock_device
    );
    void run();
};
