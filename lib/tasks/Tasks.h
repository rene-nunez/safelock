#pragma once

#include <Arduino.h>

#define TASK1_INTERVAL 1000
#define TASK2_INTERVAL 2000

class millis_tasks {
  private:
    unsigned long previous_task1_millis = 0;
    unsigned long previous_task2_millis = 0;
    unsigned long current_millis = 0;

    void run_task1();
    void run_task2();

  public:
    void run();
};
