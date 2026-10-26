#include "Tasks.h"

millis_tasks::millis_tasks(
  rfid_reader &reader,
  numpad_input &pad,
  oled_display &screen,
  rtc_clock &rtc_device,
  sd_storage &sd,
  solenoid_lock &lock_device
) : rfid(reader), numpad(pad), display(screen), rtc(rtc_device), storage(sd), lock(lock_device) {
  state_millis = millis();
  last_sd_attempt = state_millis;
}

void millis_tasks::run() {
  current_millis = millis();

  run_storage_task();
  run_rfid_task();
  run_numpad_task();
  run_lock_task();
  run_display_task();
}

void millis_tasks::run_storage_task() {
  if (state == WAIT_SD) {
    if (storage.is_ready()) return;
    if (sd_init_attempts >= SD_MAX_ATTEMPTS) return;
    if (sd_init_attempts > 0 &&
        (current_millis - last_sd_attempt) < SD_RETRY_MS) return;

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

void millis_tasks::run_rfid_task() {
  if ((current_millis - previous_rfid_millis) < RFID_POLL_INTERVAL) return;

  previous_rfid_millis = current_millis;

  if (state != ENTERING) return;

  rfid.poll();

  if (!rfid.is_card_present()) return;

  Serial.print("RFID card detected: ");
  Serial.println(rfid.get_uid_string());

  if (!rfid.is_master_set()) {
    rfid.set_master();
    Serial.println("RFID first card registered as master");
    grant_access("rfid");
    return;
  }

  if (rfid.is_authorized()) {
    Serial.println("RFID authorized");
    grant_access("rfid");
  } else {
    Serial.println("RFID unauthorized");
    deny_access();
  }
}

void millis_tasks::run_numpad_task() {
  if ((current_millis - previous_numpad_millis) < NUMPAD_POLL_INTERVAL) return;

  previous_numpad_millis = current_millis;

  char key = numpad.read_key();
  if (key == NO_KEY) return;

  Serial.print("Numpad key pressed: ");
  Serial.println(key);

  if (state != ENTERING) return;
  if (key < '0' || key > '9') return;

  add_digit(key);
}

void millis_tasks::run_lock_task() {
  lock.update();
}

void millis_tasks::run_display_task() {
  switch (state) {
    case WAIT_SD:
      if (!storage.is_ready() && sd_init_attempts < SD_MAX_ATTEMPTS) return;
      if ((current_millis - state_millis) < LOCK_SPLASH_MS) return;

      if (!storage.is_ready()) {
        Serial.print("microSD not available after ");
        Serial.print(SD_MAX_ATTEMPTS);
        Serial.println(" attempts, continuing without logging");
      }

      state = ENTERING;
      entered_digits = 0;
      display.wake();
      display.show_entry(0);
      break;

    case SUCCESS:
      if ((current_millis - state_millis) < SUCCESS_HOLD_MS) return;

      state = ENTERING;
      entered_digits = 0;
      display.show_entry(0);
      break;

    case ERROR:
      if ((current_millis - state_millis) >= ERROR_DURATION_MS) {
        state = ENTERING;
        entered_digits = 0;
        error_icon_visible = true;
        display.show_entry(0);
        return;
      }

      if ((current_millis - last_blink_millis) < ERROR_BLINK_MS) return;

      last_blink_millis = current_millis;
      error_icon_visible = !error_icon_visible;

      if (error_icon_visible) {
        display.show_error();
      } else {
        display.clear();
      }
      break;

    case ENTERING:
    case LOGGING:
      break;
  }
}

void millis_tasks::add_digit(char digit) {
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

void millis_tasks::grant_access(const char *method) {
  entered_digits = 0;
  entered_password[0] = '\0';
  display.show_success();
  lock.unlock();

  String timestamp = rtc.timestamp();

  if (timestamp.isEmpty()) {
    Serial.println("Access granted (RTC unavailable)");
    current_millis = millis();
    state = SUCCESS;
    state_millis = current_millis;
    return;
  }

  Serial.print("Access granted at ");
  Serial.println(timestamp);

  pending_date = timestamp.substring(0, 10);
  pending_time = timestamp.substring(11, 19);
  pending_method = method;

  state = LOGGING;
  state_millis = current_millis;
  last_sd_attempt = current_millis;
  sd_log_attempts = 0;

  if (!try_log_access()) {
    Serial.println("Access log pending, retrying...");
  }
}

bool millis_tasks::try_log_access() {
  if (sd_log_attempts >= SD_MAX_ATTEMPTS) {
    finish_log_without_write();
    return true;
  }

  sd_log_attempts++;

  bool saved = false;

  if (storage.is_ready() || storage.begin()) {
    saved = storage.log_access(pending_date, pending_time, pending_method);
  }

  if (saved) {
    Serial.println("Access log saved");
    current_millis = millis();
    state = SUCCESS;
    state_millis = current_millis;
    display.wake();
    display.show_success();
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

void millis_tasks::finish_log_without_write() {
  Serial.print("Access not logged: microSD unavailable after ");
  Serial.print(SD_MAX_ATTEMPTS);
  Serial.println(" attempts");

  current_millis = millis();
  state = SUCCESS;
  state_millis = current_millis;
  display.wake();
  display.show_success();
}

void millis_tasks::deny_access() {
  current_millis = millis();
  state = ERROR;
  state_millis = current_millis;
  last_blink_millis = current_millis;
  error_icon_visible = true;
  display.show_error();
}
