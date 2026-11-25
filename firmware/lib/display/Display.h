#pragma once

#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64

class Display {
  private:
    Adafruit_SSD1306 display;
    bool ready = false;

    void draw_lock_icon(int16_t horizontal_offset = 0);
    void draw_check_icon();

  public:
    Display();

    void begin();
    void recover();
    void show_lock();
    void show_unlock_frame(uint8_t frame);
    void show_error_frame(uint8_t frame);
    void show_entry(uint8_t digits);
    void show_pin_entry(uint8_t digits);
    void show_success();
    void show_manual_open();
};
