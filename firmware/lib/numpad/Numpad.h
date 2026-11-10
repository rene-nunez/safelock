#pragma once

#include <Arduino.h>
#include <Keypad.h>

class numpad_input {
  private:
    static const byte ROWS = 4;
    static const byte COLS = 3;

    static char key_map[ROWS][COLS];
    static byte row_pins[ROWS];
    static byte col_pins[COLS];

    Keypad keypad;

  public:
    numpad_input();

    void begin();
    char read_key();
};
