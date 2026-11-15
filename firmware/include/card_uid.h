#pragma once

#include <Arduino.h>
#include <stdio.h>

// Store the real length of the MFRC522 reported UIDs
struct CardUid {
  uint8_t bytes[10] = {0};
  uint8_t length = 0;

  void format(char *out, size_t size) const {
    if (size == 0) return;

    size_t pos = 0;
    out[0] = '\0';

    for (uint8_t i = 0; i < length; i++) {
      if (pos + 4 > size) break;
      if (i > 0) out[pos++] = ':';
      snprintf(out + pos, size - pos, "%02X", bytes[i]);
      pos += 2;
    }
  }
};
