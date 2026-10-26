#include "Display.h"
#include "pins.h"
#include "lock_config.h"
#include <SPI.h>

// 4 MHz para tener mas margen en el bus SPI compartido con SD y RFID.
oled_display::oled_display()
  : display(SCREEN_WIDTH, SCREEN_HEIGHT, &SPI, OLED_DC, -1, OLED_CS, 4000000) {}

void oled_display::begin() {
  if (!display.begin(SSD1306_SWITCHCAPVCC)) {
    Serial.println("OLED initialization failed");
    return;
  }

  ready = true;
  display.clearDisplay();
  display.display();
  Serial.println("OLED initialized");
}

void oled_display::reinit() {
  ready = false;

  // Deja que la alimentacion se estabilice si el acceso a la SD
  // provoco una caida de tension.
  delay(100);

  if (!display.begin(SSD1306_SWITCHCAPVCC)) {
    Serial.println("OLED reinitialization failed");
    return;
  }

  ready = true;
  display.clearDisplay();
  display.display();
  Serial.println("OLED reinitialized");
}

void oled_display::recover() {
  if (!ready) return;

  // Recupera solo el inicio de linea y vuelve a encender el panel.
  // No reconfigura multiplexado ni pines COM, para no corromper la
  // imagen si el OLED ya estaba funcionando.
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
  digitalWrite(OLED_CS, LOW);
  digitalWrite(OLED_DC, LOW);

  SPI.transfer(0x8D);  // charge pump
  SPI.transfer(0x14);  // enable
  SPI.transfer(0x40);  // start line 0
  SPI.transfer(0xAF);  // display on

  digitalWrite(OLED_CS, HIGH);
  SPI.endTransaction();
}

void oled_display::show_lock() {
  if (!ready) return;

  display.clearDisplay();
  draw_lock_icon();
  display.display();
}

void oled_display::show_entry(uint8_t digits) {
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

void oled_display::show_success() {
  if (!ready) return;

  display.clearDisplay();
  draw_check_icon();
  display.display();
}

void oled_display::show_error() {
  if (!ready) return;

  display.clearDisplay();
  draw_cross_icon();
  display.display();
}

void oled_display::clear() {
  if (!ready) return;

  display.clearDisplay();
  display.display();
}

void oled_display::draw_lock_icon() {
  const int16_t center_x = SCREEN_WIDTH / 2;
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

void oled_display::draw_check_icon() {
  for (int8_t offset = -2; offset <= 2; offset++) {
    display.drawLine(44 + offset, 32, 56 + offset, 44, WHITE);
    display.drawLine(56 + offset, 44, 84 + offset, 18, WHITE);
  }
}

void oled_display::draw_cross_icon() {
  for (int8_t offset = -2; offset <= 2; offset++) {
    display.drawLine(46 + offset, 18, 82 + offset, 54, WHITE);
    display.drawLine(82 + offset, 18, 46 + offset, 54, WHITE);
  }
}
