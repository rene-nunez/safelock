#pragma once

#include <Arduino.h>

#include <vector>

class Storage {
  private:
    bool ready = false;

  public:
    bool begin();
    void reset();
    bool is_ready();
    bool log_access(const String &timestamp, const char *source, const char *decision);

    bool read_file(const char *path, String &output);
    bool write_file(const char *path, const String &content);
    bool write_atomic(const char *final_path, const char *temp_path, const String &content);
    bool remove_file(const char *path);
    bool rename_file(const char *from, const char *to);
    bool append_line(const char *path, const String &line);
    bool read_lines(const char *path, std::vector<String> &lines);
};
