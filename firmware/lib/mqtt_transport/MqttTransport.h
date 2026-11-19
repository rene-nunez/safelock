#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <espMqttClient.h>

#include <atomic>
#include <mutex>
#include <vector>

#include <Acl.h>
#include <Clock.h>
#include <Lock.h>
#include <Net.h>
#include <LocalOutbox.h>
#include <Settings.h>

#include "mqtt_config.h"

class MqttTransport {
  private:
    Settings &settings;
    Net &net;
    Clock &clock;
    Lock &lock;
    Acl &acl;
    LocalOutbox &outbox;

    espMqttClientSecure client;

    // espMqttClient does not copy these strings: they must outlive the client
    String device_id;
    String mqtt_password;
    String status_topic;
    String heartbeat_topic;
    String commands_topic;
    String event_topic_prefix;
    String response_topic;
    String will_payload;
    String command_buffer;
    size_t command_expected = 0;

    unsigned long last_reconnect = 0;
    unsigned long last_flush = 0;
    std::atomic<unsigned long> last_heartbeat{0};
    std::atomic<bool> reset_in_flight_pending{false};

    // PUBACK runs in the MQTT task; the outbox is only touched from the loop task
    std::mutex acks_mutex;
    std::vector<uint16_t> pending_acks;

    String uuid4() const;
    String status_payload(bool online);
    void publish_status();
    void publish_heartbeat();
    void handle_command_payload(const char *topic, const uint8_t *payload, size_t len);
    void handle_command(const String &command, const JsonObject &data);
    void drain_acks();

  public:
    MqttTransport(
      Settings &settings,
      Net &net,
      Clock &clock,
      Lock &lock,
      Acl &acl,
      LocalOutbox &outbox
    );

    void begin();
    void update();

    bool connected() const;
    uint16_t publish_queued(
      const char *topic, const String &payload, uint8_t qos
    );
    bool publish_event(
      const char *suffix, const JsonObject &data, uint8_t qos = MQTT_QOS1
    );
    bool publish_response(
      const String &request_id, const char *result, const char *reason
    );
};
