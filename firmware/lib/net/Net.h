#pragma once

#include <Arduino.h>

class Net {
 private:
  String ssid;
  String password;
  unsigned long last_attempt = 0;
  unsigned long last_time_attempt = 0;
  bool was_connected = false;
  bool time_was_valid = false;

  void request_time();

 public:
  void begin(const String &ssid, const String &password, const String &device_id);
  void update();

  bool is_connected() const;
  bool time_valid() const;
  int rssi() const;
};
