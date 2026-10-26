#include "Storage.h"
#include "pins.h"

#include <SD.h>
#include <SPI.h>
#include <ArduinoJson.h>

#define SD_LOG_FILE "/accesos.json"

sd_storage::sd_storage() {}

bool sd_storage::begin() {
  if (ready) return true;

  const uint32_t frequencies[] = {4000000, 1000000};
  bool mounted = false;

  for (uint8_t i = 0; i < sizeof(frequencies) / sizeof(frequencies[0]); i++) {
    if (SD.begin(SD_CS, SPI, frequencies[i])) {
      mounted = true;
      Serial.print("microSD initialized at ");
      Serial.print(frequencies[i]);
      Serial.println(" Hz");
      break;
    }

    SD.end();
  }

  if (!mounted) {
    Serial.println("microSD initialization failed");
    ready = false;
    return false;
  }

  if (SD.cardType() == CARD_NONE) {
    Serial.println("microSD card not detected");
    SD.end();
    ready = false;
    return false;
  }

  if (!SD.exists(SD_LOG_FILE) && !create_log_file()) {
    SD.end();
    ready = false;
    return false;
  }

  ready = true;
  Serial.print("microSD size: ");
  Serial.print((uint32_t)(SD.cardSize() / (1024ULL * 1024ULL)));
  Serial.println(" MB");
  Serial.println("microSD log file: " SD_LOG_FILE);
  return true;
}

bool sd_storage::is_ready() {
  return ready;
}

void sd_storage::reset() {
  SD.end();
  ready = false;
}

bool sd_storage::log_access(const String &date, const String &time, const String &method) {
  if (!ready) return false;

  JsonDocument document;

  File input = SD.open(SD_LOG_FILE, FILE_READ);
  if (input) {
    DeserializationError error = deserializeJson(document, input);
    input.close();

    if (error) {
      Serial.print("Access log parse error: ");
      Serial.println(error.c_str());
      document.clear();
    }
  }

  if (!document.is<JsonObject>()) {
    document.clear();
  }

  JsonArray accesses = document["accesos"].to<JsonArray>();
  JsonObject entry = accesses.add<JsonObject>();
  entry["fecha"] = date;
  entry["hora"] = time;
  entry["metodo"] = method;

  File output = SD.open(SD_LOG_FILE, FILE_WRITE);
  if (!output) {
    Serial.println("Could not open access log for writing");
    return false;
  }

  size_t written = serializeJsonPretty(document, output);
  output.close();

  if (written == 0) {
    Serial.println("Could not write access log");
    return false;
  }

  return true;
}

bool sd_storage::create_log_file() {
  File file = SD.open(SD_LOG_FILE, FILE_WRITE);
  if (!file) {
    Serial.println("Could not create access log");
    return false;
  }

  file.println("{");
  file.println("  \"accesos\": []");
  file.println("}");
  file.close();
  return true;
}
