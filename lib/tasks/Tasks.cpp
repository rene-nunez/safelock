#include "Tasks.h"

millis_tasks::millis_tasks(rfid_reader &reader, numpad_input &pad)
  : rfid(reader), numpad(pad) {}

void millis_tasks::run() {
  current_millis = millis();

  run_rfid_task();
  run_numpad_task();
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
    return;
  }

  if (rfid.is_authorized()) {
    Serial.println("RFID authorized");
  } else {
    Serial.println("RFID unauthorized");
  }
}

void millis_tasks::run_numpad_task() {
  if ((current_millis - previous_numpad_millis) < NUMPAD_POLL_INTERVAL) return;

  previous_numpad_millis = current_millis;

  char key = numpad.read_key();
  if (key == NO_KEY) return;

  Serial.print("Numpad key pressed: ");
  Serial.println(key);
}
