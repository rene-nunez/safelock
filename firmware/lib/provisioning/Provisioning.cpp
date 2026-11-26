#include "Provisioning.h"

namespace {

constexpr size_t MAX_COMMAND_LENGTH = 256;
constexpr size_t MAX_TOKENS = 5;

// Quotes let a credential contain spaces. An unclosed quote or an extra token
// is an error instead of being silently accepted.
bool tokenize(const String &line, String *tokens, size_t &count) {
  bool quoted = false;
  String current;
  count = 0;

  for (unsigned int i = 0; i < line.length(); i++) {
    const char character = line[i];
    if (character == '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character == ' ' || character == '\t')) {
      if (current.length() > 0) {
        if (count >= MAX_TOKENS) return false;
        tokens[count++] = current;
        current = "";
      }
      continue;
    }
    if (current.length() >= MAX_COMMAND_LENGTH) return false;
    current += character;
  }

  if (quoted) return false;
  if (current.length() > 0) {
    if (count >= MAX_TOKENS) return false;
    tokens[count++] = current;
  }
  return true;
}

} // namespace

Provisioning::Provisioning(Settings &settings) : settings(settings) {}

void Provisioning::begin() { Serial.println("Serial commands available over USB at any time; type 'help' for commands"); }

void Provisioning::poll() {
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

void Provisioning::print_help() const {
  Serial.println("Commands:");
  Serial.println("  show                                    Show settings (passwords masked)");
  Serial.println("  set device-id sl-0001                   Stage a device ID");
  Serial.println("  set wifi \"<ssid>\" \"<password>\"          Stage WiFi credentials");
  Serial.println("  set mqtt \"<password>\"                   Stage the MQTT password");
  Serial.println("  commit                                  Validate, save and restart");
  Serial.println("  factory-reset                           Erase settings and restart");
  Serial.println("  reboot                                  Restart without changes");
  Serial.println("  provision sl-0001 <ssid> <wifi> <mqtt>  Save all and restart");
}

void Provisioning::print_value(const String &label, const String &current, const String &pending, bool secret) const {
  const String &effective = pending.length() > 0 ? pending : current;
  Serial.print("  ");
  Serial.print(label);
  Serial.print(": ");
  if (secret) {
    Serial.print(effective.length() > 0 ? "****" : "(not set)");
  } else {
    Serial.print(effective.length() > 0 ? effective : "(not set)");
  }
  if (pending.length() > 0) Serial.print(" (pending)");
  Serial.println();
}

void Provisioning::print_status() const {
  Serial.println("Settings:");
  print_value("device_id", settings.get_device_id(), pending_device_id, false);
  print_value("wifi_ssid", settings.get_wifi_ssid(), pending_wifi_ssid, false);
  print_value("wifi_password", settings.get_wifi_password(), pending_wifi_password, true);
  print_value("mqtt_password", settings.get_mqtt_password(), pending_mqtt_password, true);
}

void Provisioning::clear_pending() {
  pending_device_id = "";
  pending_wifi_ssid = "";
  pending_wifi_password = "";
  pending_mqtt_password = "";
}

void Provisioning::restart() {
  Serial.println("Restarting...");
  delay(200);
  ESP.restart();
}

void Provisioning::commit() {
  const String device_id = pending_device_id.length() > 0 ? pending_device_id : settings.get_device_id();
  const String wifi_ssid = pending_wifi_ssid.length() > 0 ? pending_wifi_ssid : settings.get_wifi_ssid();
  const String wifi_password = pending_wifi_password.length() > 0 ? pending_wifi_password : settings.get_wifi_password();
  const String mqtt_password = pending_mqtt_password.length() > 0 ? pending_mqtt_password : settings.get_mqtt_password();

  const String error = settings.set(device_id, wifi_ssid, wifi_password, mqtt_password);
  if (error.length() > 0) {
    Serial.println(error);
    Serial.println("Nothing saved; fix the value and commit again");
    return;
  }

  clear_pending();
  Serial.println("Configuration saved; restarting...");
  restart();
}

void Provisioning::handle_line(const String &line) {
  if (line.length() == 0) return;

  if (line == "help") {
    print_help();
    return;
  }
  if (line == "show") {
    print_status();
    return;
  }
  if (line == "commit") {
    commit();
    return;
  }
  if (line == "factory-reset") {
    settings.clear();
    clear_pending();
    Serial.println("Settings cleared; restarting...");
    restart();
    return;
  }
  if (line == "reboot") {
    restart();
    return;
  }

  String tokens[MAX_TOKENS];
  size_t count = 0;
  if (!tokenize(line, tokens, count)) {
    Serial.println("Invalid command; check quotes and the number of arguments");
    return;
  }

  if (tokens[0] == "set") {
    if (count < 2) {
      Serial.println("Use: set device-id <id> | set wifi <ssid> <password> | set mqtt <password>");
      return;
    }
    if (tokens[1] == "device-id") {
      if (count != 3) {
        Serial.println("Use: set device-id sl-0001");
        return;
      }
      tokens[2].toLowerCase();
      pending_device_id = tokens[2];
      Serial.println("Device ID staged; commit to apply");
      return;
    }
    if (tokens[1] == "wifi") {
      if (count != 4) {
        Serial.println("Use: set wifi \"<ssid>\" \"<password>\"");
        return;
      }
      pending_wifi_ssid = tokens[2];
      pending_wifi_password = tokens[3];
      Serial.println("WiFi credentials staged; commit to apply");
      return;
    }
    if (tokens[1] == "mqtt") {
      if (count != 3) {
        Serial.println("Use: set mqtt \"<password>\"");
        return;
      }
      pending_mqtt_password = tokens[2];
      Serial.println("MQTT password staged; commit to apply");
      return;
    }
    Serial.println("Unknown setting; use device-id, wifi or mqtt");
    return;
  }

  if (tokens[0] == "provision") {
    if (count != 5) {
      Serial.println("Use: provision sl-0001 <ssid> <wifi_password> <mqtt_password>");
      return;
    }
    tokens[1].toLowerCase();
    const String error = settings.set(tokens[1], tokens[2], tokens[3], tokens[4]);
    if (error.length() > 0) {
      Serial.println(error);
      return;
    }
    clear_pending();
    Serial.println("Configuration saved; restarting...");
    restart();
    return;
  }

  Serial.println("Unknown command; type 'help' for commands");
}
