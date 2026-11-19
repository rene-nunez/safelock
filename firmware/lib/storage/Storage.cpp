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

bool Storage::read_file(const char *path, String &output) {
  if (!ready) return false;

  File file = SD.open(path, FILE_READ);
  if (!file) return false;

  output = "";
  while (file.available()) {
    output += static_cast<char>(file.read());
  }
  file.close();
  return true;
}

bool Storage::write_file(const char *path, const String &content) {
  if (!ready) return false;

  File file = SD.open(path, FILE_WRITE);
  if (!file) return false;

  const size_t written = file.print(content);
  file.close();
  if (written != content.length()) {
    Serial.println("Storage write: short write");
    return false;
  }
  return true;
}

bool Storage::write_atomic(
  const char *final_path, const char *temp_path, const String &content
) {
  if (!write_file(temp_path, content)) return false;
  if (SD.exists(final_path) && !SD.remove(final_path)) return false;
  if (!SD.rename(temp_path, final_path)) {
    Serial.println("Storage atomic rename failed");
    return false;
  }
  return true;
}

bool Storage::remove_file(const char *path) {
  if (!ready || !SD.exists(path)) return false;
  return SD.remove(path);
}

bool Storage::rename_file(const char *from, const char *to) {
  if (!ready) return false;
  if (SD.exists(to) && !SD.remove(to)) return false;
  return SD.rename(from, to);
}

bool Storage::append_line(const char *path, const String &line) {
  if (!ready) return false;

  File file = SD.open(path, FILE_APPEND);
  if (!file) return false;

  const size_t written = file.println(line);
  file.close();
  return written > 0;
}

bool Storage::read_lines(const char *path, std::vector<String> &lines) {
  lines.clear();
  if (!ready) return false;

  File file = SD.open(path, FILE_READ);
  if (!file) return false;

  String current;
  while (file.available()) {
    const char character = static_cast<char>(file.read());
    if (character == '\n') {
      current.trim();
      if (current.length() > 0) lines.push_back(current);
      current = "";
    } else if (character != '\r' && current.length() < 4096) {
      current += character;
    }
  }
  current.trim();
  if (current.length() > 0) lines.push_back(current);

  file.close();
  return true;
}
