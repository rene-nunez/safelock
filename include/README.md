# SafeLock - Conexiones del prototipo

Este documento describe el cableado actual del firmware. La fuente de verdad para los pines es [`pins.h`](pins.h); si se cambia un pin en el codigo, hay que actualizar tambien este README.

Estado actual:

- ESP32 DevKit `esp32dev`.
- RFID MFRC522 por SPI.
- microSD por SPI.
- OLED SSD1306 128x64 por SPI.
- RTC DS1307 por I2C.
- Teclado matricial 4x3.
- Cerradura con driver DRV8871 a 12 V.
- LEDs rojo/verde por expansor PCF8574T.
- Buzzer pasivo por GPIO15 con PWM.

---

## 1. Resumen de alimentacion

| Riel | Fuente | Cargas | Capacitor de bulk | Ceramico |
|---|---|---|---|---|
| 12 V | Fuente/baterias de 12 V | DRV8871 `VM`, solenoide | 470 uF / 25 V junto al DRV8871 | 100 nF |
| 5 V | USB, fuente o buck | Modulo microSD con AMS1117, buzzer de 5 V, RTC si su modulo lo requiere | 470 uF / 16 V | 100 nF |
| 3.3 V | Regulador del ESP32 o regulador externo | ESP32, MFRC522, OLED, PCF8574T, microSD v474 | 470 uF / 10 V | 100 nF por modulo |
| GND | Comun | Todos los modulos | - | - |

Notas:

- El modulo microSD **v474** va solo a **3.3 V**. El modulo anterior con **AMS1117** va a **5 V**.
- El MFRC522 comun va a **3.3 V**. Si tu modulo trae regulador/nivelador para 5 V, sigue la serigrafia del modulo.
- Para una PCB con WiFi, usa un regulador de **3.3 V de al menos 1 A**. El regulador pequeno del DevKit puede no alcanzar con WiFi, SD, OLED y RFID al mismo tiempo.
- La fuente de 12 V debe soportar la corriente del solenoide. Verifica la corriente real de tu cerradura.

---

## 2. Mapa de pines del ESP32

| GPIO | Nombre de red | Funcion | Direccion | Modulo | Notas |
|---|---|---|---|---|---|
| 2 | `SD_CS` | Chip select microSD | Salida | microSD | Strapping. Pull-up 10 k a 3.3 V. |
| 4 | `KEY_COL_2` | Columna 2 del teclado | Salida | Teclado 4x3 | Strapping y ADC2. No poner carga fuerte al arrancar. |
| 5 | `RFID_SS` | Chip select RFID | Salida | MFRC522 | Strapping. Pull-up 10 k a 3.3 V. |
| 12 | `LOCK_IN1` | Control DRV8871 | Salida | DRV8871 | Strapping. Debe estar bajo al arrancar. No agregar pull-up. |
| 13 | `OLED_CS` | Chip select OLED | Salida | OLED | ADC2. |
| 14 | `OLED_DC` | Data/Command OLED | Salida | OLED | ADC2. |
| 15 | `BUZZER_PWM` | PWM del buzzer | Salida | Buzzer pasivo | Strapping y ADC2. Pull-down 10 k en la base del transistor. |
| 16 | `KEY_ROW_1` | Fila 1 del teclado | Entrada | Teclado 4x3 | - |
| 17 | `KEY_COL_1` | Columna 1 del teclado | Salida | Teclado 4x3 | - |
| 18 | `SPI_SCK` | Reloj SPI | Salida | SD, RFID, OLED | Compartido. |
| 19 | `SPI_MISO` | Datos SPI del esclavo al ESP32 | Entrada | SD, RFID | Compartido. OLED no usa MISO. |
| 21 | `I2C_SDA` | Datos I2C | Bidireccional | DS1307, PCF8574T | Pull-up a 3.3 V. |
| 22 | `I2C_SCL` | Reloj I2C | Salida | DS1307, PCF8574T | Pull-up a 3.3 V. |
| 23 | `SPI_MOSI` | Datos SPI del ESP32 al esclavo | Salida | SD, RFID, OLED | Compartido. |
| 25 | `KEY_ROW_3` | Fila 3 del teclado | Entrada | Teclado 4x3 | ADC2. |
| 26 | `KEY_ROW_2` | Fila 2 del teclado | Entrada | Teclado 4x3 | ADC2. |
| 27 | `RFID_RST` | Reset del MFRC522 | Salida | MFRC522 | ADC2. |
| 32 | `KEY_ROW_4` | Fila 4 del teclado | Entrada | Teclado 4x3 | ADC1. |
| 33 | `KEY_COL_3` | Columna 3 del teclado | Salida | Teclado 4x3 | ADC1. |
| 34 | `LOCK_SENSE` | Sensor de estado de la cerradura | Entrada | Cerradura | Solo entrada, sin pull-up interno: 10 k a 3.3 V obligatorio. |

Pines no usados o reservados:

| GPIO | Estado | Motivo |
|---|---|---|
| 0 | Libre | Strapping/boot. Si se usa, activo en bajo y con pull-up. |
| 1, 3 | Reservados | UART0 / monitor serie. |
| 6-11 | No usar | Conectados a la memoria flash. |
| 34-39 | Solo entrada | No tienen pull-up/pull-down interno. GPIO34 usado por `LOCK_SENSE`. |

---

## 3. Bus SPI

SPI se comparte entre microSD, MFRC522 y OLED. Cada dispositivo tiene su propio `CS`.

| Senal | GPIO | microSD | MFRC522 | OLED |
|---|---|---|---|---|
| `SPI_SCK` | 18 | `SCK` / `CLK` | `SCK` | `SCK` / `D0` |
| `SPI_MOSI` | 23 | `MOSI` | `MOSI` | `SDA` / `D1` |
| `SPI_MISO` | 19 | `MISO` | `MISO` | No conectado |
| `CS` | 2 / 5 / 13 | `CS` GPIO2 | `SDA`/`SS` GPIO5 | `CS` GPIO13 |

Reglas:

- Los tres `CS` deben estar en alto al arrancar. El firmware lo hace en `setup()`.
- Agregar pull-up de 10 k a 3.3 V en `SD_CS`, `RFID_SS` y `OLED_CS`.
- Frecuencia actual: 1 MHz para los tres dispositivos.
- La SD y el RFID comparten `MISO`. Si un modulo deja `MISO` activo aunque su `CS` este alto, el otro deja de responder. Para PCB, usar modulos con salida tri-state o agregar un buffer.
- No conectar el `RES` del OLED a GPIO15. Va directo a 3.3 V.

---

## 4. Bus I2C

| Senal | GPIO | DS1307 | PCF8574T |
|---|---|---|---|
| `I2C_SDA` | 21 | `SDA` | `SDA` |
| `I2C_SCL` | 22 | `SCL` | `SCL` |

Direcciones:

| Dispositivo | Direccion |
|---|---|
| DS1307 | `0x68` |
| PCF8574T | `0x20` a `0x27` |
| PCF8574AT | `0x38` a `0x3F` |

Notas:

- El firmware busca el PCF8574T automaticamente.
- Para direccion `0x20`, conectar `A0`, `A1` y `A2` a GND.
- Pull-ups de I2C: 4.7 k a 3.3 V. Contar solo un juego de pull-ups en todo el bus.
- Si el modulo DS1307 tiene pull-ups a 5 V, cambiarlas a 3.3 V o usar un level shifter. El ESP32 no es tolerante a 5 V en I2C.
- Para una PCB nueva, un DS3231 de 3.3 V es mas comodo que un DS1307 de 5 V.

---

## 5. Conexion por modulo

### 5.1 MFRC522 / RFID

| Pin del modulo | ESP32 | Notas |
|---|---|---|
| `SDA` / `SS` / `NSS` | GPIO5 | Chip select. |
| `SCK` | GPIO18 | Compartido. |
| `MOSI` | GPIO23 | Compartido. |
| `MISO` | GPIO19 | Compartido. |
| `IRQ` | No conectar | No se usa. |
| `GND` | GND | - |
| `RST` | GPIO27 | Reset. |
| `3.3V` | 3.3 V | No alimentar el modulo comun con 5 V. |

Proteccion:

- 100 nF entre `3.3V` y `GND` del modulo.
- 470 uF en el riel de 3.3 V.
- Mantener el RFID lejos del solenoide, cables de 12 V y del modulo SD.
- No poner plano de cobre debajo de la antena del RFID en la PCB.

### 5.2 microSD

| Pin del modulo | ESP32 | Notas |
|---|---|---|
| `VCC` | 3.3 V o 5 V | 3.3 V para v474; 5 V para el modulo con AMS1117. |
| `GND` | GND | - |
| `CS` | GPIO2 | Pull-up 10 k a 3.3 V. |
| `SCK` / `CLK` | GPIO18 | Compartido. |
| `MOSI` | GPIO23 | Compartido. |
| `MISO` | GPIO19 | Compartido. |

Proteccion:

- 100 nF entre `VCC` y `GND` del modulo. Esto fue necesario para estabilizar la SD.
- 470 uF en el riel de alimentacion de la SD.
- No alimentar el modulo v474 con 5 V.
- Si el modulo tiene level shifter, verificar que `MISO` quede en alta impedancia cuando `CS` esta alto.

### 5.3 OLED SSD1306 SPI

| Pin del modulo | ESP32 | Notas |
|---|---|---|
| `GND` | GND | - |
| `VCC` | 3.3 V | - |
| `SCK` / `D0` | GPIO18 | Compartido. |
| `SDA` / `D1` | GPIO23 | Compartido. |
| `RES` | 3.3 V | No conectar a GPIO15. |
| `DC` | GPIO14 | Data/Command. |
| `CS` | GPIO13 | Chip select. |

Proteccion:

- 100 nF entre `VCC` y `GND`.
- Mantener el OLED lejos de los cables del solenoide.

### 5.4 RTC DS1307

| Pin del modulo | ESP32 | Notas |
|---|---|---|
| `VCC` | Segun el modulo | DS1307 tipicamente 5 V. Verificar el modulo. |
| `GND` | GND | - |
| `SDA` | GPIO21 | I2C. |
| `SCL` | GPIO22 | I2C. |
| `SQW` | No conectar | No se usa. |
| `BAT` | CR2032 | Respaldo del reloj. |

Notas:

- Si el modulo tiene pull-ups de I2C a 5 V, no conectarlas directamente al ESP32. Cambiarlas a 3.3 V o usar level shifter.
- Para PCB nueva, considerar DS3231 a 3.3 V.

### 5.5 PCF8574T, LEDs de estado

| Pin del PCF8574T | Conexion | Notas |
|---|---|---|
| `VCC` | 3.3 V | - |
| `GND` | GND | - |
| `SDA` | GPIO21 | Compartido con RTC. |
| `SCL` | GPIO22 | Compartido con RTC. |
| `A0` | GND | Direccion `0x20`. |
| `A1` | GND | Direccion `0x20`. |
| `A2` | GND | Direccion `0x20`. |
| `INT` | No conectar | No se usa. |
| `P0` | LED rojo | Activo en bajo. |
| `P1` | LED verde | Activo en bajo. |
| `P2`-`P7` | Libres | Reservados para futuro. |

Conexion de LEDs:

```text
3.3 V ---- 330 ohm ---- anodo LED rojo ---- catodo ---- P0
3.3 V ---- 330 ohm ---- anodo LED verde --- catodo ---- P1
```

- `P0` en bajo enciende el rojo.
- `P1` en bajo enciende el verde.
- Al arrancar, el PCF8574 pone las salidas en alto y los LEDs quedan apagados.
- 100 nF entre `VCC` y `GND` del PCF8574T.
- Pull-ups de I2C a 3.3 V.

### 5.6 Buzzer

Buzzer pasivo en GPIO15:

```text
GPIO15 ---- 1 k ---- base NPN BC547 / 2N2222
base ---- 10 k ---- GND
emisor ---- GND
colector ---- negativo del buzzer
positivo del buzzer ---- 5 V o 3.3 V
```

- Si el buzzer es magnetico, agregar diodo `1N4148` en paralelo: catodo al positivo, anodo al colector.
- Si es un piezo pequeno de baja corriente, se puede probar directo con una resistencia de 100 ohm.
- GPIO15 es strapping. El pull-down de 10 k mantiene el transistor apagado al arrancar. Puede desactivar el log de arranque, pero no impide el arranque.
- Si el buzzer es activo, cambiar en `pins.h`:

```cpp
#define BUZZER_PASSIVE 0
```

### 5.7 Teclado matricial 4x3

| Tecla | Fila | Columna |
|---|---|---|
| 1 | `ROW_1` GPIO16 | `COL_1` GPIO17 |
| 2 | `ROW_1` GPIO16 | `COL_2` GPIO4 |
| 3 | `ROW_1` GPIO16 | `COL_3` GPIO33 |
| 4 | `ROW_2` GPIO26 | `COL_1` GPIO17 |
| 5 | `ROW_2` GPIO26 | `COL_2` GPIO4 |
| 6 | `ROW_2` GPIO26 | `COL_3` GPIO33 |
| 7 | `ROW_3` GPIO25 | `COL_1` GPIO17 |
| 8 | `ROW_3` GPIO25 | `COL_2` GPIO4 |
| 9 | `ROW_3` GPIO25 | `COL_3` GPIO33 |
| `*` | `ROW_4` GPIO32 | `COL_1` GPIO17 |
| `0` | `ROW_4` GPIO32 | `COL_2` GPIO4 |
| `#` | `ROW_4` GPIO32 | `COL_3` GPIO33 |

Notas:

- La libreria Keypad configura las filas como entradas con pull-up y las columnas como salidas.
- GPIO4 es strapping y ADC2. No agregar cargas fuertes que lo lleven a un nivel incorrecto durante el arranque.

### 5.8 Cerradura con DRV8871

| Pin del DRV8871 | Conexion | Notas |
|---|---|---|
| `VM` | 12 V | Alimentacion del motor/solenoide. |
| `GND` | GND | Tierra de potencia. |
| `IN1` | GPIO12 | Control. |
| `IN2` | GND | La cerradura se maneja en una sola direccion. |
| `OUT1` | Solenoide + | - |
| `OUT2` | Solenoide - | - |

Proteccion:

- 470 uF / 25 V entre `VM` y `GND`, lo mas cerca posible del DRV8871.
- 100 nF entre `VM` y `GND`.
- Diodo de recirculacion o TVS en paralelo con el solenoide. Para accionamiento en una sola direccion: catodo al positivo (`OUT1`), anodo al negativo (`OUT2`).
- **No conectar un capacitor de 470 uF directamente entre `OUT1` y `OUT2`.**
- Usar cables trenzados para el solenoide y mantenerlos lejos de RFID, OLED, SD y SPI.
- El retorno de corriente del solenoide debe ir directo a la fuente de 12 V, no a la tierra del ESP32.
- GPIO12 es strapping: debe estar bajo al arrancar. No agregar pull-up.

### 5.9 Sensor de estado de la cerradura

La cerradura trae un contacto seco extra (dos cables) que indica si el pestillo esta cerrado o abierto. Un cable va a **GND** y el otro a **GPIO34**.

```text
Cerradura: cable 1 ---- GND
Cerradura: cable 2 ---- GPIO34

3.3 V ---- 10 k ---- GPIO34
GPIO34 -- 1 k --+---- 100 nF ---- GND
                |
             cable del sensor
```

| Elemento | Valor | Motivo |
|---|---|---|
| Pull-up | 10 k a 3.3 V | GPIO34 no tiene pull-up interno. Es obligatorio. |
| Serie | 1 k | Limita corriente y ruido del cable largo. |
| Filtro | 100 nF a GND | Elimina ruido del solenoide y de los cables. |

Notas:

- GPIO34 es **solo entrada**. No sirve para LEDs ni para el buzzer, pero es ideal para un sensor.
- GPIO34 es ADC1, asi que sigue funcionando aunque se active WiFi (ADC2 no).
- No usa ningun pin de strapping y no interfiere con SPI, I2C ni el teclado.
- El firmware ya aplica antirrebote de 50 ms (`LOCK_SENSE_DEBOUNCE_MS`).
- Polaridad en `pins.h`:

```cpp
#define LOCK_SENSE_ACTIVE_LOW 1  // contacto cierra a GND = cerrada
#define LOCK_SENSE_ACTIVE_LOW 0  // logica invertida
```

Antes de conectar el sensor al ESP32, verifica con un multimetro:

- Que los dos cables del sensor **no** tengan continuidad con la bobina del solenoide.
- Que no haya 12 V presentes entre esos cables.
- Que el contacto cambie de estado al accionar la cerradura.

Si el sensor comparte tierra con la bobina o no estas seguro, usa un optoacoplador `PC817` para aislarlo del ESP32.

Comportamiento en el monitor serie:

```text
Lock sensor: closed
Lock sensor: open
Warning: lock still reports open after release
```

La ultima linea avisa que la cerradura no volvio a cerrar mecanicamente (o que el sensor quedo mal calibrado).

---

## 6. Capacitores y protecciones

| Ubicacion | Capacitor | Funcion |
|---|---|---|
| `VM` del DRV8871 | 470 uF / 25 V + 100 nF | Absorbe el pico del solenoide. |
| Riel de 3.3 V | 470 uF / 10 V | Estabiliza WiFi, RFID, OLED y SD. |
| Riel de 5 V | 470 uF / 16 V | Estabiliza SD con AMS1117 y buzzer. |
| VCC de cada modulo | 100 nF | Desacoplo de alta frecuencia. |
| I2C `SDA`/`SCL` | 4.7 k a 3.3 V | Pull-ups del bus. |
| `SD_CS`, `RFID_SS`, `OLED_CS` | 10 k a 3.3 V | Evitan seleccion accidental al arrancar. |
| `LOCK_SENSE` | 10 k a 3.3 V + 100 nF a GND | Pull-up obligatorio (GPIO34 no tiene interno) y filtro del sensor. |

---

## 7. Tierra y ruido

- Usar tierra en estrella: un solo punto de union entre la tierra de potencia (12 V/solenoide) y la tierra de logica (ESP32/3.3 V).
- El retorno del solenoide va directo a la fuente de 12 V.
- Trenzar los cables del solenoide y mantenerlos separados de RFID, OLED, SD y SPI.
- No pasar cables de 12 V por debajo de la antena del RFID.
- En PCB, dejar un area sin cobre debajo de la antena del RFID.
- Mantener los capacitores de desacoplo lo mas cerca posible de cada modulo.
- Evitar que el modulo SD y el RFID compartan un cable de alimentacion largo y delgado.
- Rutear el cable del sensor de la cerradura junto al par trenzado del solenoide pero separado de SPI, I2C y la antena RFID.
- No alimentar el sensor desde la etapa de 12 V: el contacto debe ser seco y referido a GND de logica.

---

## 8. Restricciones del ESP32 y WiFi

- WiFi no inutiliza los GPIO digitales.
- WiFi si inhabilita `analogRead()` en los pines ADC2: GPIO0, 2, 4, 12, 13, 14, 15, 25, 26 y 27.
- Para LEDs, buzzer y PWM no hay problema con WiFi.
- Pines strapping: GPIO0, 2, 4, 5, 12 y 15. Evitar cargas que los lleven al nivel incorrecto durante el arranque.
- GPIO12 debe estar bajo al arrancar por la tension de flash. No poner pull-up.
- GPIO15 puede desactivar el log de arranque si se lleva a bajo con el pull-down del buzzer. No impide el arranque.
- GPIO6-11 estan conectados a la flash. No usarlos.
- GPIO34-39 son solo entrada y no tienen pull-up interno. GPIO34 se usa para `LOCK_SENSE`.
- WiFi consume picos de corriente. Usar una fuente de 5 V de al menos 2 A y un regulador de 3.3 V de al menos 1 A para la PCB.

---

## 9. Notas para Proteus

- Usar etiquetas de red (net labels) con los nombres de este README para no depender del cableado fisico.
- Para el ESP32, usar un simbolo de DevKit ESP32 y mapear los GPIO segun la tabla.
- Para el MFRC522, si no hay modelo de simulacion, usar un conector de 8 pines con los nombres `SDA/SS`, `SCK`, `MOSI`, `MISO`, `IRQ`, `GND`, `RST`, `3.3V`.
- Para la microSD, usar un conector SPI de 6 pines.
- Para el OLED, usar un conector SPI de 7 pines.
- Para el PCF8574T, usar el modelo de expansor I2C y configurar la direccion `0x20`.
- Para el teclado, usar una matriz 4x3.
- Para el DRV8871, usar un simbolo de driver de motor; representar el solenoide como inductor + resistencia y agregar el diodo/TVS.
- Para el sensor de la cerradura, usar un interruptor (SW-SPST) entre `LOCK_SENSE` y GND, con pull-up de 10 k a 3.3 V y 100 nF a GND.
- Para el buzzer pasivo, usar un piezo con transistor NPN y resistencia de base.
- Para los LEDs, usar LED + resistencia de 330 ohm.
- Agregar los capacitores de desacoplo en el esquema, no solo en la PCB.
- Verificar que los `CS` de SPI tengan pull-up y esten en alto al inicio de la simulacion.

---

## 10. Notas para PCB

- Separar fisicamente la etapa de 12 V/solenoide de la etapa de logica.
- Usar pistas anchas para 12 V, 5 V y el solenoide.
- Usar plano de tierra de potencia y plano de tierra de logica unidos en un solo punto.
- Colocar el 470 uF del DRV8871 junto al pin `VM`.
- Colocar el 470 uF de 3.3 V cerca del ESP32 y del RFID/OLED.
- Colocar 100 nF junto a cada modulo.
- Dejar la antena del RFID sin cobre debajo y lejos del solenoide.
- Rutear SPI corto y directo; no hace falta igualar longitudes a 1 MHz, pero si evitar bucles y cruces con 12 V.
- Rutear I2C con pull-ups una sola vez.
- Agregar test points para 3.3 V, 5 V, 12 V, GND, `SPI_SCK`, `SPI_MOSI`, `SPI_MISO`, `I2C_SDA`, `I2C_SCL` y `LOCK_SENSE`.
- Agregar conectores etiquetados y con llave para evitar invertir módulos.
- Dejar pads para pull-ups y capacitores opcionales.
- Prever disipacion/térmica para el DRV8871 y el regulador de 3.3 V.
- Si se usa WiFi, dejar espacio para un regulador de 3.3 V externo y su capacitor de bulk.

---

## 11. Resumen de red recomendado

| Net label | GPIO / riel | Destino |
|---|---|---|
| `3V3` | 3.3 V | ESP32, RFID, OLED, PCF8574T, SD v474 |
| `5V` | 5 V | SD AMS1117, buzzer 5 V, RTC si aplica |
| `12V` | 12 V | DRV8871 `VM` |
| `GND` | GND | Todos |
| `SPI_SCK` | GPIO18 | SD, RFID, OLED |
| `SPI_MOSI` | GPIO23 | SD, RFID, OLED |
| `SPI_MISO` | GPIO19 | SD, RFID |
| `SD_CS` | GPIO2 | microSD |
| `RFID_SS` | GPIO5 | MFRC522 |
| `RFID_RST` | GPIO27 | MFRC522 |
| `OLED_CS` | GPIO13 | OLED |
| `OLED_DC` | GPIO14 | OLED |
| `OLED_RES` | 3.3 V | OLED |
| `I2C_SDA` | GPIO21 | DS1307, PCF8574T |
| `I2C_SCL` | GPIO22 | DS1307, PCF8574T |
| `KEY_ROW_1` | GPIO16 | Teclado |
| `KEY_ROW_2` | GPIO26 | Teclado |
| `KEY_ROW_3` | GPIO25 | Teclado |
| `KEY_ROW_4` | GPIO32 | Teclado |
| `KEY_COL_1` | GPIO17 | Teclado |
| `KEY_COL_2` | GPIO4 | Teclado |
| `KEY_COL_3` | GPIO33 | Teclado |
| `LOCK_IN1` | GPIO12 | DRV8871 `IN1` |
| `LOCK_IN2` | GND | DRV8871 `IN2` |
| `LOCK_SENSE` | GPIO34 | Contacto de estado de la cerradura |
| `BUZZER_PWM` | GPIO15 | Base del transistor del buzzer |
| `LED_RED` | PCF8574T `P0` | LED rojo |
| `LED_GREEN` | PCF8574T `P1` | LED verde |

---

## 12. Estado de LEDs y buzzer

| Evento | LED rojo | LED verde | Buzzer |
|---|---|---|---|
| Arranque / cerrado | Encendido | Apagado | Sin sonido |
| Acceso autorizado | Apagado | Encendido | Pitido de exito |
| Cerradura liberada | Encendido | Apagado | Sin sonido |
| Acceso denegado | Encendido | Apagado | Dos pitidos de error |

Si el PCF8574T no responde, el monitor serie muestra `PCF8574 not found`. Los LEDs no funcionan, pero el resto del sistema sigue.

---

## 13. Pendiente: RFID

El RFID sigue pendiente de diagnostico fisico. Con la microSD desconectada, el firmware reporta `RFID version: 0xFF`, lo que indica que el MFRC522 no responde por SPI. Revisar:

- Alimentacion de 3.3 V en el modulo.
- `RST` en alto.
- Continuidad de `MISO`, `MOSI`, `SCK`, `SS` y `GND`.
- Soldaduras del header, especialmente `MISO` y `RST`.
- Probar otro modulo MFRC522.

No es un problema del bus SPI compartido: SPI esta disenado para compartir `SCK`, `MOSI` y `MISO` con `CS` separados.
