#pragma once

#include <Arduino.h>
#include <Rfid.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include <Lock.h>
#include <Indicators.h>
#include <Acl.h>
#include <MqttTransport.h>
#include "config.h"

// Poll and recovery intervals
#define RFID_POLL_INTERVAL 200
#define NUMPAD_POLL_INTERVAL 20
#define RFID_RECOVER_INTERVAL 2000 // Throttle blocking recovery attempts

// Screen timings
#define LOCK_SPLASH_MS 1500
#define SUCCESS_HOLD_MS 2000
#define ERROR_DURATION_MS 2500
#define ALERT_HOLD_MS 4000

// Animations
#define UNLOCK_ANIMATION_FRAMES 7
#define UNLOCK_ANIMATION_INTERVAL_MS 120
#define ERROR_ANIMATION_MS 250

// microSD access log
#define SD_RETRY_MS 1000
#define SD_MAX_ATTEMPTS 10

class Tasks : public MqttCommandHandler {
  private:
    enum lock_state { WAIT_SD, ENTERING, SUCCESS, LOGGING, ERROR, ALERT };

    Rfid &rfid;
    Numpad &numpad;
    Display &display;
    Clock &clock;
    Storage &storage;
    Lock &lock;
    Indicators &indicators;
    Acl &acl;
    MqttTransport &mqtt;

    // Loop clock
    unsigned long current_millis = 0;

    // State machine
    lock_state state = WAIT_SD;
    unsigned long state_millis = 0;

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

    // Enrollment
    bool enrollment_active = false;
    String enrollment_request_id;
    unsigned long enrollment_until = 0;

    // PIN entry
    bool pin_active = false;
    String pin_uid;
    String pin_credential_id;
    String pin_buffer;
    unsigned long pin_until = 0;

    // Pollers
    void run_storage_task();
    void run_rfid_task();
    void run_numpad_task();
    void run_lock_task();
    void run_display_task();

    // RFID health
    bool ensure_rfid_ready();
    void log_rfid_unhealthy();
    const char *state_name() const;

    // State transitions
    void start_entry();
    void handle_card(const String &uid);
    void grant_access(const char *method, uint16_t duration_ms = 0);
    void deny_access();
    void alert_manual_open();
    void publish_decision(
      const char *decision,
      const char *reason,
      const char *source,
      const String &uid,
      const String &credential_id
    );
    void cancel_enrollment();
    void start_pin_entry(const String &uid, const String &credential_id);
    void cancel_pin_entry();
    void submit_pin();

    // Access log
    bool try_log_access();
    void finish_log_without_write();

  public:
    Tasks(
      Rfid &rfid,
      Numpad &numpad,
      Display &display,
      Clock &clock,
      Storage &storage,
      Lock &lock,
      Indicators &indicators,
      Acl &acl,
      MqttTransport &mqtt
    );

    void begin();
    void run();
    bool begin_enrollment(const String &request_id, uint32_t ttl_s) override;
    void handle_remote_unlock(uint16_t duration_ms) override;
};
