#include "Display.h"
#include "pins.h"
#include "config.h"

#include <SPI.h>

// 1 MHz keeps margin with long wires and a noisy SPI bus
static const uint32_t OLED_SPI_HZ = 1000000;

Display::Display() : display(SCREEN_WIDTH, SCREEN_HEIGHT, &SPI, OLED_DC, -1, OLED_CS, OLED_SPI_HZ) {}

void Display::begin() {
  ready = false;

  // Let the 3V3 rail settle after a microSD burst
  delay(100);

  if (!display.begin(SSD1306_SWITCHCAPVCC)) {
    Serial.println("Display begin: failed");
    return;
  }

  ready = true;
  display.clearDisplay();
  display.display();
  Serial.println("Display begin: ok");
}

void Display::recover() {
  if (!ready) return;

  display.ssd1306_command(SSD1306_CHARGEPUMP);
  display.ssd1306_command(0x14); // Charge pump enable
  display.ssd1306_command(SSD1306_SETSTARTLINE);
  display.ssd1306_command(SSD1306_DISPLAYON);
}

void Display::draw_centered_text(
  const char *text,
  int16_t y,
  uint8_t size
) {
  int16_t x1, y1;
  uint16_t w, h;

  display.setTextSize(size);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);

  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);

  display.setCursor((SCREEN_WIDTH - w) / 2 - x1, y);
  display.print(text);
}

void Display::draw_padlock(
  int16_t cx,
  int16_t top,
  uint8_t opening
) {
  if (opening > 12) opening = 12;

  int16_t ax = cx + opening;
  int16_t ay = top - opening / 2;

  display.drawRoundRect(
    ax - 10, ay, 20, 25, 9, SSD1306_WHITE
  );

  display.drawRoundRect(
    ax - 9, ay + 1, 18, 23, 8, SSD1306_WHITE
  );

  display.fillRect(
    ax - 11, ay + 16, 22, 10, SSD1306_BLACK
  );

  if (opening > 0) {
    display.drawLine(
      ax - 10, ay + 9,
      ax - 10, ay + 15,
      SSD1306_WHITE
    );
  }

  display.fillRoundRect(
    cx - 17, top + 16,
    34, 25, 4,
    SSD1306_WHITE
  );

  display.fillCircle(
    cx, top + 25, 3, SSD1306_BLACK
  );

  display.fillTriangle(
    cx, top + 26,
    cx - 3, top + 34,
    cx + 3, top + 34,
    SSD1306_BLACK
  );
}

void Display::draw_lock_icon(int16_t horizontal_offset) {
  draw_padlock(64 + horizontal_offset, 4, 0);
}

void Display::draw_check_icon() {
  display.drawCircle(64, 24, 19, SSD1306_WHITE);
  display.drawCircle(64, 24, 18, SSD1306_WHITE);

  for (int8_t i = -1; i <= 1; i++) {
    display.drawLine(
      53, 24 + i, 61, 32 + i, SSD1306_WHITE
    );

    display.drawLine(
      61, 32 + i, 76, 16 + i, SSD1306_WHITE
    );
  }
}

void Display::draw_cross(int16_t cx, int16_t cy) {
  display.drawCircle(cx, cy, 18, SSD1306_WHITE);
  display.drawCircle(cx, cy, 17, SSD1306_WHITE);

  for (int8_t i = -1; i <= 1; i++) {
    display.drawLine(
      cx - 7, cy - 7 + i,
      cx + 7, cy + 7 + i,
      SSD1306_WHITE
    );

    display.drawLine(
      cx + 7, cy - 7 + i,
      cx - 7, cy + 7 + i,
      SSD1306_WHITE
    );
  }
}

void Display::show_lock() {
  if (!ready) return;

  display.clearDisplay();

  draw_lock_icon();

  display.drawFastHLine(
    25, 49, 78, SSD1306_WHITE
  );

  draw_centered_text("LOCKED", 54);

  display.display();
}

void Display::show_unlock_frame(uint8_t frame) {
  if (!ready) return;

  display.clearDisplay();

  uint8_t opening = (frame >= 6) ? 12 : frame * 2;

  draw_padlock(64, 4, opening);

  draw_centered_text("UNLOCKING", 54);

  display.display();
}

void Display::show_success() {
  if (!ready) return;

  display.clearDisplay();

  draw_check_icon();

  draw_centered_text("ACCESS GRANTED", 53);

  display.display();
}

void Display::show_error_frame(uint8_t frame) {
  if (!ready) return;

  static const int8_t offsets[] = {
    0, -4, 4, -3, 3, -2, 2, 0
  };

  uint8_t index = frame % 8;

  display.clearDisplay();

  draw_cross(64 + offsets[index], 24);

  draw_centered_text("ACCESS DENIED", 53);

  display.display();
}

void Display::show_manual_open() {
  if (!ready) return;

  display.clearDisplay();

  draw_padlock(64, 4, 12);

  draw_centered_text("MANUAL OPEN", 54);

  display.display();
}

void Display::show_entry() {
  if (!ready) return;

  display.clearDisplay();

  draw_lock_icon();

  draw_centered_text("TAP CARD", 54);

  display.display();
}

void Display::show_pin_entry(uint8_t digits) {
  if (!ready) return;

  display.clearDisplay();

  const char *prompt = "ENTER PIN";
  // Cap the visible mask: the buffer accepts longer PINs than the OLED can show.
  const uint8_t max_visible = 12;
  if (digits > max_visible) digits = max_visible;

  char mask[max_visible + 1];
  for (uint8_t i = 0; i < digits; i++) mask[i] = '*';
  mask[digits] = '\0';

  int16_t x1 = 0;
  int16_t y1 = 0;
  uint16_t width = 0;
  uint16_t height = 0;

  display.setTextSize(1);
  display.setTextColor(WHITE);

  display.getTextBounds(prompt, 0, 0, &x1, &y1, &width, &height);
  display.setCursor((SCREEN_WIDTH - width) / 2, 2);
  display.print(prompt);

  display.getTextBounds(mask, 0, 0, &x1, &y1, &width, &height);
  display.setCursor((SCREEN_WIDTH - width) / 2, 32);
  display.print(mask);

  display.display();
}
