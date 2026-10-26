#pragma once

#include <Arduino.h>

#define PASSWORD_LENGTH 5
#define DEFAULT_PASSWORD "12345"

// Tiempo que la cerradura permanece energizada al autorizar un acceso.
#define LOCK_OPEN_MS 3000

// Nivel que activa el DRV8871.
// HIGH: IN1 en alto energiza la cerradura (configuracion normal).
// LOW:  invierte la logica si tu cerradura funciona al reves.
#define LOCK_ACTIVE_LEVEL HIGH
