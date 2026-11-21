#pragma once

#include <cstddef>

namespace validators {

bool valid_device_id(const char *value, size_t length);
bool valid_wifi_ssid(const char *value, size_t length);
bool valid_wifi_password(const char *value, size_t length);
bool valid_mqtt_password(const char *value, size_t length);

} // namespace validators
