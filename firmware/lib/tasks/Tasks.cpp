#include "Tasks.h"

Tasks::Tasks(
  RFID &rfid,
  Numpad &numpad,
  Display &display,
  Clock &clock,
  Storage &storage,
  Lock &lock,
  Indicators &indicators
) : rfid(rfid), numpad(numpad), display(display), clock(clock), storage(storage), lock(lock), indicators(indicators) {
  state_millis = millis();
  last_sd_attempt = state_millis;
}

void Tasks::run() {
  current_millis = millis();

  run_storage_task();
  run_rfid_task();
  run_numpad_task();
  run_lock_task();
  run_display_task();
  indicators.update();
}

void Tasks::run_storage_task() {
  if (state == WAIT_SD) {
    if (storage.is_ready()) return;
    if (sd_init_attempts >= SD_MAX_ATTEMPTS) return;
    if (sd_init_attempts > 0 && (current_millis - last_sd_attempt) < SD_RETRY_MS) return;

    last_sd_attempt = current_millis;
    sd_init_attempts++;

    Serial.print("microSD init attempt ");
    Serial.print(sd_init_attempts);
    Serial.print("/");
    Serial.println(SD_MAX_ATTEMPTS);

    storage.begin();
    return;
  }

  if (state != LOGGING) return;
  if ((current_millis - last_sd_attempt) < SD_RETRY_MS) return;

  last_sd_attempt = current_millis;

  if (!try_log_access()) {
    Serial.println("Access log pending, retrying...");
  }
}

void Tasks::run_rfid_task() {
  if ((current_millis - previous_rfid_millis) < RFID_POLL_INTERVAL) return;

  previous_rfid_millis = current_millis;

  if (state != ENTERING) return;

  RFID::ScanResult scan = rfid.poll();

  if (scan == RFID::UNHEALTHY) {
    if ((current_millis - last_rfid_recover_millis) < RFID_RECOVER_INTERVAL) return;
    last_rfid_recover_millis = current_millis;

    // Don't block the keypad while the user is typing the password
    if (entered_digits == 0) rfid.recover();
    return;
  }

  if (scan == RFID::NO_CARD) return;

  char uid_text[32];
  rfid.last_uid().format(uid_text, sizeof(uid_text));

  Serial.print("RFID card detected: ");
  Serial.println(uid_text);

  const char *allowed[] = ALLOWED_UIDS;
  bool authorized = false;

  for (uint8_t i = 0; i < ALLOWED_UID_COUNT; i++) {
    if (strcmp(uid_text, allowed[i]) == 0) {
      authorized = true;
      break;
    }
  }

  if (authorized) {
    Serial.println("RFID authorized");
    grant_access("rfid");
  } else {
    Serial.println("RFID unauthorized");
    deny_access();
  }
}

void Tasks::run_numpad_task() {
  if ((current_millis - previous_numpad_millis) < NUMPAD_POLL_INTERVAL) return;

  previous_numpad_millis = current_millis;

  char key = numpad.read_key();
  if (key == NO_KEY) return;
  if (state != ENTERING) return;

  Serial.print("Numpad key pressed: ");
  Serial.println(key);

  if (key < '0' || key > '9') return;

  add_digit(key);
}

void Tasks::run_lock_task() {
  bool was_active = lock.is_active();
  lock.update();

  if (lock.sense_changed()) {
    Serial.print("Lock sensor: ");
    Serial.println(lock.is_closed() ? "closed" : "open");
  }

  if (was_active && !lock.is_active()) {
    indicators.show_locked();

    if (!lock.is_closed()) {
      Serial.println("Warning: lock still reports open after release");
    }
  }
}

void Tasks::run_display_task() {
  if (unlock_animation_active) {
    if ((current_millis - last_unlock_animation_millis) < UNLOCK_ANIMATION_INTERVAL_MS) return;

    last_unlock_animation_millis = current_millis;
    unlock_animation_frame++;

    if (unlock_animation_frame >= UNLOCK_ANIMATION_FRAMES) {
      unlock_animation_active = false;
      display.show_success();
      if (state == SUCCESS) state_millis = current_millis;
    } else {
      display.show_unlock_frame(unlock_animation_frame);
    }

    return;
  }

  switch (state) {
    case WAIT_SD:
      if (!storage.is_ready() && sd_init_attempts < SD_MAX_ATTEMPTS) return;
      if ((current_millis - state_millis) < LOCK_SPLASH_MS) return;

      if (!storage.is_ready()) {
        Serial.print("microSD not available after ");
        Serial.print(SD_MAX_ATTEMPTS);
        Serial.println(" attempts, continuing without logging");
      }

      start_entry();
      break;

    case SUCCESS:
      if ((current_millis - state_millis) < SUCCESS_HOLD_MS) return;
      if (lock.is_active()) return;

      rfid.recover();
      display.recover();
      start_entry();
      break;

    case ERROR:
      if ((current_millis - state_millis) >= ERROR_DURATION_MS) {
        start_entry();
        return;
      }

      if ((current_millis - last_error_animation_millis) < ERROR_ANIMATION_MS) return;

      last_error_animation_millis = current_millis;
      error_animation_frame++;
      display.show_error_frame(error_animation_frame);
      break;

    case ENTERING:
    case LOGGING:
      break;
  }
}

void Tasks::start_entry() {
  state = ENTERING;
  entered_digits = 0;
  display.show_entry(0);
}

void Tasks::grant_access(const char *method) {
  entered_digits = 0;
  entered_password[0] = '\0';
  unlock_animation_active = true;
  unlock_animation_frame = 0;
  last_unlock_animation_millis = current_millis;
  display.show_unlock_frame(unlock_animation_frame);
  lock.unlock();
  indicators.show_unlocked();
  indicators.beep_ok();

  String timestamp = clock.timestamp();

  if (timestamp.isEmpty()) {
    Serial.println("Access granted (RTC unavailable)");
  } else {
    Serial.print("Access granted at ");
    Serial.println(timestamp);
  }

  pending_timestamp = timestamp;
  pending_method = method;

  state = LOGGING;
  state_millis = current_millis;
  last_sd_attempt = current_millis;
  sd_log_attempts = 0;

  if (!try_log_access()) {
    Serial.println("Access log pending, retrying...");
  }
}

void Tasks::deny_access() {
  current_millis = millis();
  state = ERROR;
  state_millis = current_millis;
  last_error_animation_millis = current_millis;
  error_animation_frame = 0;
  indicators.show_locked();
  indicators.beep_error();
  display.show_error_frame(error_animation_frame);
}

bool Tasks::try_log_access() {
  sd_log_attempts++;

  bool saved = false;

  if (storage.is_ready() || storage.begin()) {
    saved = storage.log_access(pending_timestamp, pending_method);
  }

  if (saved) {
    Serial.println("Access log saved");
    current_millis = millis();
    state = SUCCESS;
    state_millis = current_millis;
    return true;
  }

  storage.reset();

  Serial.print("Access log attempt ");
  Serial.print(sd_log_attempts);
  Serial.print("/");
  Serial.print(SD_MAX_ATTEMPTS);
  Serial.println(" failed");

  if (sd_log_attempts >= SD_MAX_ATTEMPTS) {
    finish_log_without_write();
    return true;
  }

  return false;
}

void Tasks::finish_log_without_write() {
  Serial.print("Access not logged: microSD unavailable after ");
  Serial.print(SD_MAX_ATTEMPTS);
  Serial.println(" attempts");

  current_millis = millis();
  state = SUCCESS;
  state_millis = current_millis;
  display.recover();
  display.show_success();
}

void Tasks::add_digit(char digit) {
  if (entered_digits >= PASSWORD_LENGTH) return;

  entered_password[entered_digits] = digit;
  entered_digits++;
  entered_password[entered_digits] = '\0';

  display.show_entry(entered_digits);

  if (entered_digits < PASSWORD_LENGTH) return;

  if (strcmp(entered_password, DEFAULT_PASSWORD) == 0) {
    grant_access("password");
  } else {
    deny_access();
  }
}
