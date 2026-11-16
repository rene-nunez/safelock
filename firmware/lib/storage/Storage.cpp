#include "Storage.h"
#include "pins.h"

#include <SD.h>
#include <SPI.h>
#include <ArduinoJson.h>

#define SD_LOG_FILE "/log.json"

bool Storage::begin() {
  if (ready) return true;

  // Hold CS high and give the module time to stabilize its supply before trying to mount the card
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  delay(20);

  // 1 MHz is more tolerant of level shifters and long cables; 400 kHz is the fallback
  const uint32_t frequencies[] = {1000000, 400000};
  uint32_t mounted_hz = 0;

  for (uint8_t i = 0; i < sizeof(frequencies) / sizeof(frequencies[0]); i++) {
    if (SD.begin(SD_CS, SPI, frequencies[i])) {
      mounted_hz = frequencies[i];
      break;
    }

    SD.end();
    digitalWrite(SD_CS, HIGH);
  }

  if (mounted_hz == 0) {
    Serial.println("Storage begin: failed");
    ready = false;
    return false;
  }

  if (SD.cardType() == CARD_NONE) {
    Serial.println("Storage begin: no card");
    SD.end();
    ready = false;
    return false;
  }

  // Catches a full or read-only card at boot and creates the file on first use
  File probe = SD.open(SD_LOG_FILE, FILE_APPEND);
  if (!probe) {
    Serial.println("Storage begin: log file failed");
    SD.end();
    ready = false;
    return false;
  }

  probe.close();
  ready = true;

  Serial.printf(
    "Storage begin: ok (%u Hz, %u MB)\n",
    static_cast<unsigned>(mounted_hz),
    static_cast<unsigned>(SD.cardSize() / (1024ULL * 1024ULL))
  );

  return true;
}

bool Storage::is_ready() {
  return ready;
}

void Storage::reset() {
  SD.end();
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  ready = false;
}

bool Storage::log_access(const String &timestamp, const char *source, const char *decision) {
  if (!ready) return false;

  JsonDocument document;
  if (timestamp.isEmpty()) {
    document["ts"] = nullptr;
  } else {
    document["ts"] = timestamp;
  }
  document["source"] = source;
  document["decision"] = decision;

  File file = SD.open(SD_LOG_FILE, FILE_APPEND);

  if (!file) {
    Serial.println("Storage log: open failed");
    return false;
  }

  size_t written = serializeJson(document, file);
  file.println(); // One log per line

  file.close();

  if (written == 0) {
    Serial.println("Storage log: write failed");
    return false;
  }

  return true;
}
