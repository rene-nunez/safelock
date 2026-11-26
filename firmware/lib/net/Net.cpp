#include "Net.h"

#include <WiFi.h>
#include <time.h>

namespace {

constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr unsigned long WIFI_RETRY_MS = 5000;
constexpr unsigned long TIME_SYNC_TIMEOUT_MS = 10000;
constexpr unsigned long TIME_RETRY_MS = 30000;
constexpr time_t MIN_VALID_EPOCH = 1700000000; // 2023-11-14

} // namespace

void Net::begin(const String &ssid, const String &password) {
  this->ssid = ssid;
  this->password = password;

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), password.c_str());

  Serial.print("WiFi connecting to ");
  Serial.print(ssid);
  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (!is_connected()) {
    Serial.println("WiFi connect: failed; will retry in the background");
    was_connected = false;
    return;
  }

  was_connected = true;
  Serial.print("WiFi connected, RSSI ");
  Serial.println(rssi());

  request_time();
  const unsigned long sync_started = millis();
  while (!time_valid() && millis() - sync_started < TIME_SYNC_TIMEOUT_MS) {
    delay(250);
  }
  time_was_valid = time_valid();
  Serial.print("Network time: ");
  Serial.println(time_was_valid ? "ok" : "unavailable");
}

void Net::request_time() {
  // SNTP has to be re-armed after a reconnect: DNS may have been unavailable
  // when WiFi first came up, and configTime() is what starts the polling.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  last_time_attempt = millis();
  Serial.println("Network time: sync requested");
}

void Net::update() {
  const bool connected = is_connected();
  if (connected != was_connected) {
    was_connected = connected;
    if (connected) {
      Serial.print("WiFi connected, RSSI ");
      Serial.println(rssi());
      request_time();
    } else {
      Serial.println("WiFi lost");
    }
  }

  const bool valid = time_valid();
  if (valid != time_was_valid) {
    time_was_valid = valid;
    Serial.println(valid ? "Network time: ok" : "Network time: lost");
  }

  if (!connected) {
    if (millis() - last_attempt < WIFI_RETRY_MS) return;
    last_attempt = millis();
    if (ssid.length() == 0) return;

    Serial.println("WiFi reconnecting");
    WiFi.reconnect();
    return;
  }

  if (!valid && millis() - last_time_attempt >= TIME_RETRY_MS) request_time();
}

bool Net::is_connected() const { return WiFi.status() == WL_CONNECTED; }
bool Net::time_valid() const { return time(nullptr) >= MIN_VALID_EPOCH; }
int Net::rssi() const { return WiFi.RSSI(); }
