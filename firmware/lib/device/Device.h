#pragma once

#include <RFID.h>
#include <Numpad.h>
#include <Display.h>
#include <Clock.h>
#include <Storage.h>
#include <Lock.h>
#include <Indicators.h>
#include <Settings.h>
#include <Net.h>
#include <Tasks.h>

class Device {
  private:
    Settings settings;
    Net net;

    RFID rfid;
    Numpad numpad;
    Display display;
    Clock clock;
    Storage storage;
    Lock lock;
    Indicators indicators;

    // Must stay last: it holds references to all the members above
    Tasks tasks;

  public:
    Device();

    void begin();
    void run();
};
