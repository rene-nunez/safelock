#pragma once

#include <Rfid.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include <Lock.h>
#include <Indicators.h>
#include <Settings.h>
#include <Provisioning.h>
#include <Net.h>
#include <Acl.h>
// Relative path: <Outbox.h> resolves to the one in espMqttClient's libdeps.
#include "../outbox/Outbox.h"
#include <MqttTransport.h>
#include <Tasks.h>

class Device {
  private:
    Settings settings;
    Provisioning provisioning;
    Net net;

    Rfid rfid;
    Numpad numpad;
    Display display;
    Clock clock;
    Storage storage;
    Lock lock;
    Indicators indicators;

    Acl acl;
    Outbox outbox;
    MqttTransport mqtt;
    bool clock_synced = false;

    // Must stay last: it holds references to all the members above
    Tasks tasks;

  public:
    Device();

    void begin();
    void run();
};
