#pragma once

#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64

class oled_display {
  private:
    Adafruit_SSD1306 display;
    bool ready = false;

    void draw_lock_icon();
    void draw_check_icon();
    void draw_cross_icon();

  public:
    oled_display();

    void begin();
    void reinit();
    void recover();
    void show_lock();
    void show_entry(uint8_t digits);
    void show_success();
    void show_error();
    void clear();
};
