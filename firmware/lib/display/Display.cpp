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
  const int16_t movement = frame > 5 ? 10 : frame * 2;

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

  display.clearDisplay();

  const int16_t slot_width = 14;
  const int16_t slot_gap = 8;
  const int16_t total_width =
    PASSWORD_LENGTH * slot_width + (PASSWORD_LENGTH - 1) * slot_gap;
  const int16_t start_x = (SCREEN_WIDTH - total_width) / 2;
  const int16_t line_y = 40;

  for (uint8_t i = 0; i < PASSWORD_LENGTH; i++) {
    int16_t x = start_x + i * (slot_width + slot_gap);

    display.drawLine(x, line_y, x + slot_width, line_y, WHITE);

    if (i < digits) {
      display.fillCircle(x + slot_width / 2, line_y - 9, 4, WHITE);
    }
  }

  display.display();
}

void Display::show_success() {
  if (!ready) return;

  display.clearDisplay();
  draw_check_icon();
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
