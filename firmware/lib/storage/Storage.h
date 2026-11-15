#pragma once

#include <Arduino.h>

class Storage {
  private:
    bool ready = false;

  public:
    Storage();

    bool begin();
    void reset();
    bool is_ready();
    bool log_access(const String &timestamp, const char *source);
};
