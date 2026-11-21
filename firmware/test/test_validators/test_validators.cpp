#include <unity.h>

#include <validators.h>

void test_device_id_format() {
  TEST_ASSERT_TRUE(safelock::valid_device_id("sl-0001", 7));
  // Provisioning lowercases the device ID before validating it.
  TEST_ASSERT_FALSE(safelock::valid_device_id("SL-0001", 7));
  TEST_ASSERT_FALSE(safelock::valid_device_id("sl-000", 6));
  TEST_ASSERT_FALSE(safelock::valid_device_id("sl-00012", 8));
  TEST_ASSERT_FALSE(safelock::valid_device_id("sl-00a1", 7));
  TEST_ASSERT_FALSE(safelock::valid_device_id("xx-0001", 7));
}

void test_wifi_ssid() {
  TEST_ASSERT_TRUE(safelock::valid_wifi_ssid("home", 4));
  TEST_ASSERT_FALSE(safelock::valid_wifi_ssid("", 0));
  TEST_ASSERT_FALSE(safelock::valid_wifi_ssid("a\nb", 3));
}

void test_wifi_password_length() {
  TEST_ASSERT_TRUE(safelock::valid_wifi_password("12345678", 8));
  TEST_ASSERT_FALSE(safelock::valid_wifi_password("1234567", 7));
  TEST_ASSERT_FALSE(safelock::valid_wifi_password("", 0));
}

void test_quotes_are_rejected() {
  TEST_ASSERT_FALSE(safelock::valid_wifi_ssid("my\"ssid", 8));
  TEST_ASSERT_FALSE(safelock::valid_mqtt_password("my\"pass", 8));
}

void test_mqtt_password() {
  TEST_ASSERT_TRUE(safelock::valid_mqtt_password("secret", 6));
  TEST_ASSERT_FALSE(safelock::valid_mqtt_password("", 0));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_device_id_format);
  RUN_TEST(test_wifi_ssid);
  RUN_TEST(test_wifi_password_length);
  RUN_TEST(test_quotes_are_rejected);
  RUN_TEST(test_mqtt_password);
  return UNITY_END();
}
