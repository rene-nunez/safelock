#pragma once

#include <Arduino.h>
#include <Settings.h>

class Provisioning {
  private:
    Settings &settings;
    String serial_buffer;
    String pending_device_id;
    String pending_wifi_ssid;
    String pending_wifi_password;
    String pending_mqtt_password;
    bool line_too_long = false;

    void handle_line(const String &line);
    void commit();
    void print_help() const;
    void print_status() const;
    void print_value(const String &label, const String &current, const String &pending, bool secret) const;
    void clear_pending();
    static void restart();

  public:
    explicit Provisioning(Settings &settings);

    void begin();
    void poll();
};
