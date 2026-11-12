// Diagnostico aislado de la microSD. No inicializa RFID ni OLED: solo el
// bus SPI y el CS de la tarjeta. Sirve para separar un fallo de hardware
// (tarjeta, modulo, cableado o alimentacion) de un problema de integracion
// con el resto del firmware.
//
//   pio run -e sdprobe -t upload
//   pio device monitor -e sdprobe
//
// Con -DCORE_DEBUG_LEVEL=3 el core ESP32 imprime en que comando SD falla
// ("GO_IDLE_STATE failed", "no token received", "crc error", etc.).
#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include "pins.h"

static const uint32_t SD_PROBE_FREQS[] = {4000000, 1000000, 400000, 100000};
static bool mounted = false;
static unsigned long last_report = 0;

static const char *reset_reason_name(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:  return "POWERON";
    case ESP_RST_EXT:      return "EXT";
    case ESP_RST_SW:       return "SW";
    case ESP_RST_PANIC:    return "PANIC";
    case ESP_RST_INT_WDT:  return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT:      return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT (revisar alimentacion)";
    case ESP_RST_SDIO:     return "SDIO";
    default:               return "UNKNOWN";
  }
}

static void print_card_info() {
  Serial.print("cardType: ");
  switch (SD.cardType()) {
    case CARD_MMC:  Serial.println("MMC"); break;
    case CARD_SD:   Serial.println("SDSC"); break;
    case CARD_SDHC: Serial.println("SDHC/SDXC"); break;
    default:        Serial.println("NONE/UNKNOWN"); break;
  }

  Serial.print("size: ");
  Serial.print((uint32_t)(SD.cardSize() / 1048576ULL));
  Serial.println(" MB");
}

static void print_root_dir() {
  File dir = SD.open("/");
  if (!dir) {
    Serial.println("root: could not open");
    return;
  }

  Serial.println("root dir:");
  File entry = dir.openNextFile();
  uint8_t count = 0;

  while (entry && count < 20) {
    Serial.print("  ");
    Serial.print(entry.name());
    if (!entry.isDirectory()) {
      Serial.print("  ");
      Serial.print((uint32_t)entry.size());
      Serial.print(" bytes");
    }
    Serial.println();
    entry.close();
    entry = dir.openNextFile();
    count++;
  }

  dir.close();
}

static bool write_read_test() {
  const char *path = "/probe.txt";

  File out = SD.open(path, FILE_WRITE);
  if (!out) {
    Serial.println("write: could not open /probe.txt");
    return false;
  }
  out.printf("probe %lu ms\n", millis());
  out.close();
  Serial.println("write: ok");

  File in = SD.open(path, FILE_READ);
  if (!in) {
    Serial.println("read: could not open /probe.txt");
    return false;
  }

  Serial.print("read: ");
  while (in.available()) {
    Serial.write(in.read());
  }
  in.close();
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("=== SafeLock SD probe ===");
  Serial.print("reset reason: ");
  Serial.println(reset_reason_name(esp_reset_reason()));

  // Todos los CS del bus en alto; este probe solo habla con la SD.
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(RFID_SS, OUTPUT);
  digitalWrite(RFID_SS, HIGH);
  pinMode(OLED_CS, OUTPUT);
  digitalWrite(OLED_CS, HIGH);

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, -1);

  for (uint8_t i = 0; i < sizeof(SD_PROBE_FREQS) / sizeof(SD_PROBE_FREQS[0]); i++) {
    uint32_t hz = SD_PROBE_FREQS[i];
    Serial.print("SD.begin @ ");
    Serial.print(hz);
    Serial.println(" Hz ...");

    if (SD.begin(SD_CS, SPI, hz)) {
      mounted = true;
      Serial.println("  -> mounted");
      break;
    }

    Serial.println("  -> failed");
    SD.end();
    digitalWrite(SD_CS, HIGH);
    delay(200);
  }

  if (!mounted) {
    Serial.println("RESULT: card not mounted.");
    Serial.println("Check 3.3 V at the module, wiring, CS pull-up and that");
    Serial.println("the card is FAT32 (exFAT/NTFS are not supported).");
    return;
  }

  print_card_info();
  print_root_dir();
  write_read_test();
  Serial.println("RESULT: SD stack OK.");
}

void loop() {
  unsigned long now = millis();
  if ((now - last_report) < 2000) return;
  last_report = now;

  Serial.print("[");
  Serial.print(now / 1000);
  Serial.print(" s] ");

  if (!mounted) {
    Serial.println("no mount (ver salida de setup)");
    return;
  }

  Serial.print("card ");
  Serial.print(SD.cardType() == CARD_NONE ? "GONE" : "ok");
  Serial.print(", /probe.txt ");
  Serial.println(SD.exists("/probe.txt") ? "present" : "missing");
}
