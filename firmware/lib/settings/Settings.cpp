#include "Settings.h"
#include <validators.h>

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
  return loaded && safelock::valid_device_id(device_id.c_str(), device_id.length()) &&
         safelock::valid_wifi_ssid(wifi_ssid.c_str(), wifi_ssid.length()) &&
         safelock::valid_wifi_password(wifi_password.c_str(), wifi_password.length()) &&
         safelock::valid_mqtt_password(mqtt_password.c_str(), mqtt_password.length());
}

String Settings::set(const String &new_device_id, const String &new_wifi_ssid,
                     const String &new_wifi_password, const String &new_mqtt_password) {
  if (!safelock::valid_device_id(new_device_id.c_str(), new_device_id.length())) {
    return "Invalid device_id; use the format sl-0001";
  }
  if (!safelock::valid_wifi_ssid(new_wifi_ssid.c_str(), new_wifi_ssid.length())) {
    return "Invalid WiFi SSID; use 1-32 printable characters";
  }
  if (!safelock::valid_wifi_password(new_wifi_password.c_str(), new_wifi_password.length())) {
    return "Invalid WiFi password; use 8-63 printable characters";
  }
  if (!safelock::valid_mqtt_password(new_mqtt_password.c_str(), new_mqtt_password.length())) {
    return "Invalid MQTT password; use 1-128 printable characters";
  }

  Preferences preferences;
  preferences.begin("safelock", false);
  preferences.putString("device_id", new_device_id);
  preferences.putString("wifi_ssid", new_wifi_ssid);
  preferences.putString("wifi_password", new_wifi_password);
  preferences.putString("mqtt_password", new_mqtt_password);
  preferences.end();

  device_id = new_device_id;
  wifi_ssid = new_wifi_ssid;
  wifi_password = new_wifi_password;
  mqtt_password = new_mqtt_password;
  loaded = true;
  return "";
}

void Settings::clear() {
  Preferences preferences;
  preferences.begin("safelock", false);
  preferences.clear();
  preferences.end();
  device_id = "";
  wifi_ssid = "";
  wifi_password = "";
  mqtt_password = "";
}

const String &Settings::get_device_id() const { return device_id; }
const String &Settings::get_wifi_ssid() const { return wifi_ssid; }
const String &Settings::get_wifi_password() const { return wifi_password; }
const String &Settings::get_mqtt_password() const { return mqtt_password; }
