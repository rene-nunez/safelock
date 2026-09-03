#include "Tasks.h"

void millis_tasks::run() {
  current_millis = millis();

  run_task1();
  run_task2();
}

void millis_tasks::run_task1() {
  if((current_millis - previous_task1_millis) >= TASK1_INTERVAL) {
    Serial.println("Task 1");
    previous_task1_millis = current_millis;
  }
}

void millis_tasks::run_task2() {
  if((current_millis - previous_task2_millis) >= TASK2_INTERVAL) {
    Serial.println("Task 2");
    previous_task2_millis = current_millis;
  }
}
