#include "Numpad.h"
#include "pins.h"

char Numpad::key_map[ROWS][COLS] = {
  {'1', '2', '3'},
  {'4', '5', '6'},
  {'7', '8', '9'},
  {'*', '0', '#'}
};

byte Numpad::row_pins[ROWS] = {
  NUMPAD_ROW_1, NUMPAD_ROW_2, NUMPAD_ROW_3, NUMPAD_ROW_4
};

byte Numpad::col_pins[COLS] = {
  NUMPAD_COL_1, NUMPAD_COL_2, NUMPAD_COL_3
};

Numpad::Numpad() : keypad(makeKeymap(key_map), row_pins, col_pins, ROWS, COLS) {}

void Numpad::begin() {
  Serial.println("Numpad 4x3 initialized");
}

char Numpad::read_key() {
  return keypad.getKey();
}
