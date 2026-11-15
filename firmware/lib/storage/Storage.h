#pragma once

#include <Arduino.h>

class Storage {
  private:
    bool ready = false;

    bool create_log_file();

  public:
    Storage();

    bool begin();
    void reset();
    bool is_ready();
    bool log_access(const String &date, const String &time, const String &method);
};
