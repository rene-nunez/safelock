#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <espMqttClient.h>

#include <atomic>
#include <deque>
#include <mutex>
#include <vector>

#include <Acl.h>
#include <Clock.h>
#include <Lock.h>
#include <Net.h>
// Relative path: <Outbox.h> resolves to the one in espMqttClient's libdeps.
#include "../outbox/Outbox.h"
#include <Settings.h>

#include "mqtt_config.h"

class MqttCommandHandler {
  public:
    virtual bool begin_enrollment(const String &request_id, uint32_t ttl_s) = 0;
    virtual void handle_remote_unlock(uint16_t duration_ms) = 0;
};

// The library keeps the TLS transport protected; expose its timeouts so a
// blocked handshake cannot stall reconnection for the default 120 s.
class SafelockMqttClient : public espMqttClientSecure {
  public:
    explicit SafelockMqttClient(espMqttClientTypes::UseInternalTask use_internal_task)
      : espMqttClientSecure(use_internal_task) {}

    void set_timeouts(uint16_t tcp_seconds, uint16_t handshake_seconds) {
      _client.client.setTimeout(tcp_seconds);
      _client.client.setHandshakeTimeout(handshake_seconds);
    }
};

class MqttTransport {
  private:
    Settings &settings;
    Net &net;
    Clock &clock;
    Lock &lock;
    Acl &acl;
    Outbox &outbox;
    MqttCommandHandler *command_handler = nullptr;

    SafelockMqttClient client;

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

    struct CallbackEvent {
      enum class Type { Connected, Disconnected, Message };

      CallbackEvent() : type(Type::Connected) {}
      explicit CallbackEvent(Type event_type) : type(event_type) {}

      Type type;
      String topic;
      String payload;
      espMqttClientTypes::DisconnectReason reason{};
    };

    unsigned long last_reconnect = 0;
    unsigned long last_flush = 0;
    std::atomic<unsigned long> last_heartbeat{0};

    // Callbacks run in the MQTT task. They only queue data; all application
    // state (ACL, tasks, outbox, SD) is touched from the loop task.
    std::mutex callbacks_mutex;
    std::deque<CallbackEvent> callback_events;
    std::mutex acks_mutex;
    std::vector<uint16_t> pending_acks;

    void drain_callbacks();
    String uuid4() const;
    String envelope(const JsonObject &data) const;
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
      Outbox &outbox
    );

    void begin();
    void update();
    void set_command_handler(MqttCommandHandler &handler);

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
