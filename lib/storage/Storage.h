#pragma once

#include <Arduino.h>

class sd_storage {
  private:
    bool ready = false;

    bool create_log_file();

  public:
    sd_storage();

    bool begin();
    void reset();
    bool is_ready();
    bool log_access(const String &date, const String &time, const String &method);
};
