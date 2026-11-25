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

void Display::show_lock() {
  if (!ready) return;

  display.clearDisplay();
  draw_lock_icon();
  display.display();
}

void Display::show_unlock_frame(uint8_t frame) {
  if (!ready) return;

  display.clearDisplay();

  const int16_t center_x = SCREEN_WIDTH / 2;
  const int16_t body_top = 28;
  const int16_t body_width = 40;
  const int16_t body_height = 28;
  const int16_t movement = frame * 2;

  display.drawCircle(center_x + movement, body_top - movement, 12, WHITE);
  display.drawCircle(center_x + movement, body_top - movement, 13, WHITE);

  display.fillRoundRect(
    center_x - body_width / 2, body_top, body_width, body_height, 5, WHITE
  );
  display.fillCircle(center_x, body_top + 11, 4, BLACK);
  display.fillRect(center_x - 2, body_top + 11, 4, 9, BLACK);

  display.display();
}

void Display::show_error_frame(uint8_t frame) {
  if (!ready) return;

  static const int8_t shake_offsets[] = {0, -5, 5, -4, 4, -3, 3, 0};
  const uint8_t frame_count = sizeof(shake_offsets) / sizeof(shake_offsets[0]);

  display.clearDisplay();
  draw_lock_icon(shake_offsets[frame % frame_count]);
  display.display();
}

void Display::show_entry(uint8_t digits) {
  if (!ready) return;
  (void)digits; // No digit slots: the PIN length is never disclosed on the OLED

  display.clearDisplay();
  draw_lock_icon();

  const char *text = "TAP CARD";
  int16_t x1 = 0;
  int16_t y1 = 0;
  uint16_t width = 0;
  uint16_t height = 0;

  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.getTextBounds(text, 0, 0, &x1, &y1, &width, &height);
  display.setCursor((SCREEN_WIDTH - width) / 2, 2);
  display.print(text);

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

void Display::show_success() {
  if (!ready) return;

  display.clearDisplay();
  draw_check_icon();
  display.display();
}

void Display::show_manual_open() {
  if (!ready) return;

  display.clearDisplay();
  draw_lock_icon();

  const char *text = "MANUAL OPEN";
  int16_t x1 = 0;
  int16_t y1 = 0;
  uint16_t width = 0;
  uint16_t height = 0;

  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.getTextBounds(text, 0, 0, &x1, &y1, &width, &height);
  display.setCursor((SCREEN_WIDTH - width) / 2, 2);
  display.print(text);

  display.display();
}

void Display::draw_lock_icon(int16_t horizontal_offset) {
  const int16_t center_x = SCREEN_WIDTH / 2 + horizontal_offset;
  const int16_t body_top = 28;
  const int16_t body_width = 40;
  const int16_t body_height = 28;

  display.drawCircle(center_x, body_top, 12, WHITE);
  display.drawCircle(center_x, body_top, 13, WHITE);

  display.fillRoundRect(
    center_x - body_width / 2, body_top, body_width, body_height, 5, WHITE
  );

  display.fillCircle(center_x, body_top + 11, 4, BLACK);
  display.fillRect(center_x - 2, body_top + 11, 4, 9, BLACK);
}

void Display::draw_check_icon() {
  for (int8_t offset = -2; offset <= 2; offset++) {
    display.drawLine(44 + offset, 32, 56 + offset, 44, WHITE);
    display.drawLine(56 + offset, 44, 84 + offset, 18, WHITE);
  }
}
