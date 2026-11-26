#pragma once

#include <Arduino.h>

class Storage {
  private:
    bool ready = false;

  public:
    bool begin();
    void reset();
    bool is_ready();
    bool log_access(const String &timestamp, const char *source, const char *decision);

    bool read_file(const char *path, String &output);
    bool read_file_with_fallback(const char *path, const char *temp_path, String &output);
    bool write_file(const char *path, const String &content);
    bool write_atomic(const char *final_path, const char *temp_path, const String &content);
};
