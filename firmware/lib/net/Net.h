#pragma once

#include <Arduino.h>

class Net {
 private:
  String ssid;
  String password;
  unsigned long last_attempt = 0;

 public:
  void begin(const String &ssid, const String &password);
  void update();

  bool is_connected() const;
  bool time_valid() const;
  int rssi() const;
};
