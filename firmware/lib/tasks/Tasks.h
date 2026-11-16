#pragma once

#include <Arduino.h>
#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include <Lock.h>
#include <Indicators.h>
#include "config.h"

// Poll and recovery intervals
#define RFID_POLL_INTERVAL 200
#define NUMPAD_POLL_INTERVAL 20
#define RFID_RECOVER_INTERVAL 2000 // A reset blocks up to ~400 ms

// Screen timings
#define LOCK_SPLASH_MS 1500
#define SUCCESS_HOLD_MS 2000
#define ERROR_DURATION_MS 2500

// Animations
#define UNLOCK_ANIMATION_FRAMES 6
#define UNLOCK_ANIMATION_INTERVAL_MS 120
#define ERROR_ANIMATION_MS 250

// microSD access log
#define SD_RETRY_MS 1000
#define SD_MAX_ATTEMPTS 10

class Tasks {
  private:
    enum lock_state { WAIT_SD, ENTERING, SUCCESS, LOGGING, ERROR };

    // Collaborators
    RFID &rfid;
    Numpad &numpad;
    Display &display;
    Clock &clock;
    Storage &storage;
    Lock &lock;
    Indicators &indicators;

    // Loop clock
    unsigned long current_millis = 0;

    // State machine
    lock_state state = WAIT_SD;
    unsigned long state_millis = 0;

    // Keypad entry
    char entered_password[PASSWORD_LENGTH + 1] = "";
    uint8_t entered_digits = 0;

    // Unlock animation
    bool unlock_animation_active = false;
    uint8_t unlock_animation_frame = 0;
    unsigned long last_unlock_animation_millis = 0;

    // Error animation
    uint8_t error_animation_frame = 0;
    unsigned long last_error_animation_millis = 0;

    // Access log
    String pending_timestamp;
    const char *pending_method = "";
    uint8_t sd_init_attempts = 0;
    uint8_t sd_log_attempts = 0;
    unsigned long last_sd_attempt = 0;

    // Poll throttles
    unsigned long previous_rfid_millis = 0;
    unsigned long last_rfid_recover_millis = 0;
    unsigned long previous_numpad_millis = 0;

    // Pollers
    void run_storage_task();
    void run_rfid_task();
    void run_numpad_task();
    void run_lock_task();
    void run_display_task();

    // State transitions
    void start_entry();
    void grant_access(const char *method);
    void deny_access();

    // Access log
    bool try_log_access();
    void finish_log_without_write();

    // Input
    void add_digit(char digit);

  public:
    Tasks(
      RFID &rfid,
      Numpad &numpad,
      Display &display,
      Clock &clock,
      Storage &storage,
      Lock &lock,
      Indicators &indicators
    );
    void run();
};
