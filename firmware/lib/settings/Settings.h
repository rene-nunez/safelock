#pragma once

#include <Arduino.h>
#include <Preferences.h>

class Settings {
 private:
  String device_id;
  String wifi_ssid;
  String wifi_password;
  String mqtt_password;
  String serial_buffer;
  bool loaded = false;
  bool line_too_long = false;

  void handle_line(const String &line);

 public:
  bool begin();
  bool is_provisioned() const;
  void poll_provisioning();

  const String &get_device_id() const;
  const String &get_wifi_ssid() const;
  const String &get_wifi_password() const;
  const String &get_mqtt_password() const;
};
