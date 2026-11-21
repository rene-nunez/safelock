#include "validators.h"

namespace {

constexpr size_t MIN_WIFI_PASSWORD_LENGTH = 8;
constexpr size_t MAX_WIFI_PASSWORD_LENGTH = 63;
constexpr size_t MAX_WIFI_SSID_LENGTH = 32;
constexpr size_t MAX_MQTT_PASSWORD_LENGTH = 128;

// Double quotes delimit serial arguments and have no escape sequence.
bool valid_text(const char *value, size_t length) {
  for (size_t i = 0; i < length; i++) {
    const unsigned char character = static_cast<unsigned char>(value[i]);
    if (character < 0x20 || character > 0x7E || character == '"') return false;
  }
  return true;
}

} // namespace

namespace safelock {

bool valid_device_id(const char *value, size_t length) {
  if (length != 7 || value[0] != 's' || value[1] != 'l' || value[2] != '-') return false;
  for (size_t i = 3; i < length; i++) {
    if (value[i] < '0' || value[i] > '9') return false;
  }
  return true;
}

bool valid_wifi_ssid(const char *value, size_t length) {
  return length > 0 && length <= MAX_WIFI_SSID_LENGTH && valid_text(value, length);
}

bool valid_wifi_password(const char *value, size_t length) {
  return length >= MIN_WIFI_PASSWORD_LENGTH && length <= MAX_WIFI_PASSWORD_LENGTH &&
         valid_text(value, length);
}

bool valid_mqtt_password(const char *value, size_t length) {
  return length > 0 && length <= MAX_MQTT_PASSWORD_LENGTH && valid_text(value, length);
}

} // namespace safelock
