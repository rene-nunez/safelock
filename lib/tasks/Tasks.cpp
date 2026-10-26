#include "Tasks.h"

millis_tasks::millis_tasks(rfid_reader &reader, numpad_input &pad, oled_display &screen)
  : rfid(reader), numpad(pad), display(screen) {
  state_millis = millis();
}

void millis_tasks::run() {
  current_millis = millis();

  run_rfid_task();
  run_numpad_task();
  run_display_task();
}

void millis_tasks::run_rfid_task() {
  if ((current_millis - previous_rfid_millis) < RFID_POLL_INTERVAL) return;

  previous_rfid_millis = current_millis;
  rfid.poll();

  if (!rfid.is_card_present()) return;

  Serial.print("RFID card detected: ");
  Serial.println(rfid.get_uid_string());

  if (!rfid.is_master_set()) {
    rfid.set_master();
    Serial.println("RFID first card registered as master");
    grant_access();
    return;
  }

  if (rfid.is_authorized()) {
    Serial.println("RFID authorized");
    grant_access();
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

void millis_tasks::run_display_task() {
  switch (state) {
    case SPLASH:
      if ((current_millis - state_millis) < LOCK_SPLASH_MS) return;

      state = ENTERING;
      entered_digits = 0;
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
    grant_access();
  } else {
    deny_access();
  }
}

void millis_tasks::grant_access() {
  state = SUCCESS;
  state_millis = current_millis;
  entered_digits = 0;
  entered_password[0] = '\0';
  display.show_success();
}

void millis_tasks::deny_access() {
  state = ERROR;
  state_millis = current_millis;
  last_blink_millis = current_millis;
  error_icon_visible = true;
  display.show_error();
}
