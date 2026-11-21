#pragma once

#include <Arduino.h>
#include <Preferences.h>

class Settings {
  private:
    String device_id;
    String wifi_ssid;
    String wifi_password;
    String mqtt_password;
    bool loaded = false;

  public:
    bool begin();
    bool is_provisioned() const;

    // Returns an empty string on success, or a validation error. All fields are
    // checked before anything is written, so a bad value cannot leave NVS half-set.
    String set(const String &device_id, const String &wifi_ssid,
               const String &wifi_password, const String &mqtt_password);
    void clear();

    const String &get_device_id() const;
    const String &get_wifi_ssid() const;
    const String &get_wifi_password() const;
    const String &get_mqtt_password() const;
};
