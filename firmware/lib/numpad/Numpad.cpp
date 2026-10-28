#include "Numpad.h"
#include "pins.h"

char numpad_input::key_map[ROWS][COLS] = {
  {'1', '2', '3'},
  {'4', '5', '6'},
  {'7', '8', '9'},
  {'*', '0', '#'}
};

byte numpad_input::row_pins[ROWS] = {
  NUMPAD_ROW_1, NUMPAD_ROW_2, NUMPAD_ROW_3, NUMPAD_ROW_4
};

byte numpad_input::col_pins[COLS] = {
  NUMPAD_COL_1, NUMPAD_COL_2, NUMPAD_COL_3
};

numpad_input::numpad_input()
  : keypad(makeKeymap(key_map), row_pins, col_pins, ROWS, COLS) {}

void numpad_input::begin() {
  Serial.println("Numpad 4x3 initialized");
}

char numpad_input::read_key() {
  return keypad.getKey();
}
