#include "Settings.h"

namespace {

constexpr size_t MAX_COMMAND_LENGTH = 256;

bool valid_device_id(const String &value) {
  if (value.length() != 7 || !value.startsWith("sl-")) return false;
  for (unsigned int i = 3; i < value.length(); i++) {
    if (value[i] < '0' || value[i] > '9') return false;
  }
  return true;
}

// Quotes let a password contain spaces without changing the command format.
void tokenize(const String &line, String *tokens, size_t capacity, size_t &count) {
  bool quoted = false;
  String current;
  count = 0;

  for (unsigned int i = 0; i < line.length(); i++) {
    char character = line[i];
    if (character == '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character == ' ' || character == '\t')) {
      if (current.length() > 0 && count < capacity) {
        tokens[count++] = current;
        current = "";
      }
      continue;
    }
    if (current.length() < MAX_COMMAND_LENGTH) current += character;
  }

  if (current.length() > 0 && count < capacity) tokens[count++] = current;
}

} // namespace

bool Settings::begin() {
  Preferences preferences;
  preferences.begin("safelock", false);
  device_id = preferences.getString("device_id", "");
  wifi_ssid = preferences.getString("wifi_ssid", "");
  wifi_password = preferences.getString("wifi_password", "");
  mqtt_password = preferences.getString("mqtt_password", "");
  preferences.end();
  loaded = true;
  return is_provisioned();
}

bool Settings::is_provisioned() const {
  return loaded && valid_device_id(device_id) && wifi_ssid.length() > 0 && mqtt_password.length() > 0;
}

void Settings::poll_provisioning() {
  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\r') continue;

    if (character == '\n') {
      if (line_too_long) {
        Serial.println("Command too long; ignored");
      } else {
        String line = serial_buffer;
        line.trim();
        handle_line(line);
      }
      serial_buffer = "";
      line_too_long = false;
      continue;
    }

    if (line_too_long) continue;

    if (serial_buffer.length() < MAX_COMMAND_LENGTH) {
      serial_buffer += character;
    } else {
      line_too_long = true;
      serial_buffer = "";
    }
  }
}

void Settings::handle_line(const String &line) {
  if (line == "factory-reset") {
    Preferences preferences;
    preferences.begin("safelock", false);
    preferences.clear();
    preferences.end();
    device_id = "";
    wifi_ssid = "";
    wifi_password = "";
    mqtt_password = "";
    Serial.println("Settings cleared; provision again");
    return;
  }

  String tokens[5];
  size_t count = 0;
  tokenize(line, tokens, 5, count);
  if (count == 0 || tokens[0] != "provision") return;

  if (count != 5) {
    Serial.println("Use: provision sl-0001 <wifi_ssid> <wifi_password> <mqtt_password>");
    return;
  }

  tokens[1].toLowerCase();
  if (!valid_device_id(tokens[1])) {
    Serial.println("Invalid device_id; use the format sl-0001");
    return;
  }
  if (tokens[2].length() == 0 || tokens[3].length() == 0 || tokens[4].length() == 0) {
    Serial.println("WiFi SSID, WiFi password and MQTT password are required");
    return;
  }

  Preferences preferences;
  preferences.begin("safelock", false);
  preferences.putString("device_id", tokens[1]);
  preferences.putString("wifi_ssid", tokens[2]);
  preferences.putString("wifi_password", tokens[3]);
  preferences.putString("mqtt_password", tokens[4]);
  preferences.end();

  device_id = tokens[1];
  wifi_ssid = tokens[2];
  wifi_password = tokens[3];
  mqtt_password = tokens[4];
  loaded = true;

  // Never echo the credentials themselves.
  Serial.print("Provisioned device ");
  Serial.println(device_id);
}

const String &Settings::get_device_id() const { return device_id; }
const String &Settings::get_wifi_ssid() const { return wifi_ssid; }
const String &Settings::get_wifi_password() const { return wifi_password; }
const String &Settings::get_mqtt_password() const { return mqtt_password; }
