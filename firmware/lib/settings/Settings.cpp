#include "Settings.h"
#include <validators.h>

#include <ArduinoJson.h>

namespace {

constexpr char CONFIG_KEY[] = "config";
constexpr char LEGACY_DEVICE_ID[] = "device_id";
constexpr char LEGACY_WIFI_SSID[] = "wifi_ssid";
constexpr char LEGACY_WIFI_PASSWORD[] = "wifi_password";
constexpr char LEGACY_MQTT_PASSWORD[] = "mqtt_password";

} // namespace

bool Settings::begin() {
  Preferences preferences;
  preferences.begin("safelock", false);

  const String payload = preferences.getString(CONFIG_KEY, "");
  preferences.end();

  if (payload.length() > 0) {
    JsonDocument document;
    if (deserializeJson(document, payload) == DeserializationError::Ok) {
      device_id = document["device_id"] | "";
      wifi_ssid = document["wifi_ssid"] | "";
      wifi_password = document["wifi_password"] | "";
      mqtt_password = document["mqtt_password"] | "";
      loaded = true;
      return is_provisioned();
    }
  }

  // Devices provisioned before the single-value format stored four keys.
  preferences.begin("safelock", false);
  device_id = preferences.getString(LEGACY_DEVICE_ID, "");
  wifi_ssid = preferences.getString(LEGACY_WIFI_SSID, "");
  wifi_password = preferences.getString(LEGACY_WIFI_PASSWORD, "");
  mqtt_password = preferences.getString(LEGACY_MQTT_PASSWORD, "");
  preferences.end();

  loaded = true;
  return is_provisioned();
}

bool Settings::is_provisioned() const {
  return loaded && validators::valid_device_id(device_id.c_str(), device_id.length()) &&
         validators::valid_wifi_ssid(wifi_ssid.c_str(), wifi_ssid.length()) &&
         validators::valid_wifi_password(wifi_password.c_str(), wifi_password.length()) &&
         validators::valid_mqtt_password(mqtt_password.c_str(), mqtt_password.length());
}

String Settings::set(const String &new_device_id, const String &new_wifi_ssid, const String &new_wifi_password, const String &new_mqtt_password) {
  if (!validators::valid_device_id(new_device_id.c_str(), new_device_id.length())) {
    return "Invalid device_id; use the format sl-0001";
  }
  if (!validators::valid_wifi_ssid(new_wifi_ssid.c_str(), new_wifi_ssid.length())) {
    return "Invalid WiFi SSID; use 1-32 printable characters";
  }
  if (!validators::valid_wifi_password(new_wifi_password.c_str(), new_wifi_password.length())) {
    return "Invalid WiFi password; use 8-63 printable characters";
  }
  if (!validators::valid_mqtt_password(new_mqtt_password.c_str(), new_mqtt_password.length())) {
    return "Invalid MQTT password; use 1-128 printable characters";
  }

  // NVS commits one key atomically: store the whole configuration together so
  // a power loss cannot mix an old password with a new device ID.
  JsonDocument document;
  document["device_id"] = new_device_id;
  document["wifi_ssid"] = new_wifi_ssid;
  document["wifi_password"] = new_wifi_password;
  document["mqtt_password"] = new_mqtt_password;

  String payload;
  serializeJson(document, payload);

  Preferences preferences;
  preferences.begin("safelock", false);
  preferences.putString(CONFIG_KEY, payload);
  preferences.remove(LEGACY_DEVICE_ID);
  preferences.remove(LEGACY_WIFI_SSID);
  preferences.remove(LEGACY_WIFI_PASSWORD);
  preferences.remove(LEGACY_MQTT_PASSWORD);
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
  loaded = false;
}

const String &Settings::get_device_id() const { return device_id; }
const String &Settings::get_wifi_ssid() const { return wifi_ssid; }
const String &Settings::get_wifi_password() const { return wifi_password; }
const String &Settings::get_mqtt_password() const { return mqtt_password; }
