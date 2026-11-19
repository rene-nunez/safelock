#pragma once

#include <Arduino.h>
#include <espMqttClient.h>

#include <atomic>

#include <Clock.h>
#include <Lock.h>
#include <Net.h>
#include <Settings.h>

class MqttTransport {
 private:
  Settings &settings;
  Net &net;
  Clock &clock;
  Lock &lock;

  espMqttClientSecure client;

  // espMqttClient does not copy these strings: they must outlive the client
  String device_id;
  String mqtt_password;
  String status_topic;
  String heartbeat_topic;
  String commands_topic;
  String will_payload;

  unsigned long last_reconnect = 0;
  std::atomic<unsigned long> last_heartbeat{0};

  String uuid4() const;
  String status_payload(bool online);
  void publish_status();
  void publish_heartbeat();

 public:
  MqttTransport(Settings &settings, Net &net, Clock &clock, Lock &lock);

  void begin();
  void update();
};
