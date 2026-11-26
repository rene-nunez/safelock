# AGENTS.md

Memoria del proyecto para agentes. Si algo aquí contradice una suposición, este documento manda. Si hay que cambiar una decisión, se cambia aquí en el mismo commit.

## Proyecto y estado

Safelock es un sistema de control de acceso con RFID (MFRC522), teclado, pantalla OLED y reloj RTC. Tiene backend (FastAPI), frontend (React) y base de datos (MongoDB Atlas). Es un monorepo.

**Hardware:** ESP32, MFRC522 (SPI), teclado 4x3, SSD1306 (SPI), DS1307 (I2C), LEDs por PCF8574T y buzzer pasivo. La cerradura es electromagnética de 12 V controlada por un DRV8871, *fail-secure* (sin energía queda cerrada). Su contacto va a `LOCK_SENSE_PIN` (GPIO34) y se usa para saber si el pestillo está cerrado o abierto (con antirrebote). No mide si la puerta está abierta. Sensor de puerta, botón de salida, UPS y llave mecánica están contemplados pero aún no implementados.

- `firmware/`: PlatformIO (`src/`, `lib/`, `include/`, `platformio.ini`). Compila con `pio run -d firmware`.
- `backend/` y `frontend/`: existen pero están vacíos.
- `Makefile`: envuelve los comandos principales (`make help`).
- En desarrollo: Mosquitto local y MongoDB Atlas.

## Decisiones principales

| Área | Decisión |
|---|---|
| Alcance | Un solo sitio, N dispositivos, 1 puerta por dispositivo. `site` va embebido, sin multi-tenant |
| Acceso por tarjeta | **Local-first**: el dispositivo decide con su lista de acceso local. El backend no está en la ruta crítica |
| Credenciales | El UID identifica la tarjeta. El PIN es un segundo factor **por tarjeta** (opcional) |
| PIN | Lo verifica **solo el backend**, por TLS. Largo variable (≥ 6; `#` envía, `*` borra). El dispositivo nunca lo valida ni lo guarda. El `operator` puede fijar o resetear el PIN de una credencial; solo el `admin` cambia `requires_pin` del dispositivo |
| Bajas | Credenciales y dispositivos se **revocan o retiran**; el borrado duro solo se permite sin historial (credencial sin `access_events`, dispositivo que nunca se conectó). Baja del portador revoca todas sus credenciales; su borrado duro solo se permite sin credenciales ni historial y es solo para `admin`. Reactivar al portador restaura solo las tarjetas revocadas por esa baja; el `restore` individual exige portador activo |
| Sin conexión | Tarjetas: según `offline_policy` y `stale_acl_hours` (72 h). PIN: siempre denegado sin backend |
| Bloqueo remoto | `locked: true` en la configuración: el dispositivo niega todo acceso |
| Enrolamiento | **Por toque**: el backend inicia el modo, el dispositivo envía el UID leído y el admin confirma en la web |
| Instalación | Credenciales iniciales por **serie/USB** (device_id, WiFi, MQTT); se pueden corregir en cualquier momento por el mismo puerto. Sin credencial de fábrica |
| Roles | `admin`: usuarios, configuración de dispositivos y auditoría. `operator`: operación diaria (ver, abrir, portadores, credenciales, enrolamiento) |
| Mapa | Leaflet + Stadia Maps (Alidade Bright, estilo claro). UI solo en modo oscuro. Ubicación manual por dispositivo |

## Cómo se decide el acceso

Lo importante es si **el dispositivo puede comunicarse con el backend ahora**.

| Situación | Tarjeta | PIN |
|---|---|---|
| Backend disponible | Se permite con la lista local (rápido) y se registra | Se permite si el backend lo valida |
| Backend no disponible | Según `offline_policy` y `stale_acl_hours`; el evento se guarda para enviar después | Denegado |

- **Tarjeta**: la decide el dispositivo (en la lista, activa y vigente según el RTC). **PIN, revocación y apertura remota**: los decide el backend.
- El PIN es por tarjeta y opcional. `requires_pin` se configura por dispositivo. Una puerta con PIN es **solo online**: sin backend se deniega (no hay modo "solo tarjeta").
- Bloqueo remoto (`locked`): niega todo acceso mientras esté activo.
- Tarjeta fuera de la lista: se niega localmente (`decision: "denied"`, `reason: "acl_absent"`) pero se envía el evento.
- Apertura manual (llave o switch): el pestillo se abre sin energizar la bobina → alerta local (OLED + buzzer) y evento `decision: "unknown"`, `source: "manual"`, `reason: "manual_open"`. Sin energía no se registra.
- RTC inválido: se reporta en el `heartbeat`; las vigencias se evalúan con la hora de red cuando está disponible y TLS depende solo de esa hora.

## Protocolo MQTT

La fuente de verdad es `docs/protocol.md`. Si cambia el protocolo, se actualizan juntos: `docs/protocol.md`, simulador, backend y firmware.

- MQTT **3.1.1**, QoS 1, TLS 8883. `status` retenido + LWT.
- **Usuario MQTT = `device_id`**. Sin firma en el mensaje (TLS + credenciales del broker + permisos de topics).

Base: `safelock/devices/{device_id}`

| Topic | Dirección | QoS | Retenido | Contenido |
|---|---|---|---|---|
| `.../events/card-scan` | dispositivo → backend | 1 | no | UID leído en enrolamiento |
| `.../events/pin-entry` | dispositivo → backend | 1 | no | PIN ingresado (dentro de TLS) |
| `.../events/access-decision` | dispositivo → backend | 1 | no | Decisión aplicada |
| `.../status` | dispositivo → backend | 1 | **sí** | Estado (firmware, lista, política, cerradura) |
| `.../heartbeat` | dispositivo → backend | 0 | no | Estado periódico (cada 30–60 s) |
| `.../commands/enroll` | backend → dispositivo | 1 | no | Iniciar modo enrolamiento |
| `.../commands/unlock` | backend → dispositivo | 1 | no | Abrir cerradura |
| `.../commands/synchronize-access-list` | backend → dispositivo | 1 | no | Snapshot completo de configuración + lista de acceso |
| `.../response` | dispositivo → backend | 1 | no | Resultado de un comando |

Formato de mensaje (todos los topics):

```json
{ "id": "<uuid4>", "ts": 1761000000, "device_id": "sl-0001", "data": {} }
```

- `id` duplicado se descarta. `ts` en segundos (UTC); si el reloj no es válido se marca `degraded`.
- **PIN**: viaja en `events/pin-entry` dentro de TLS. El backend guarda `Argon2id(pin)` y aplica límites de intentos por credencial. El contador se limpia con PIN correcto; mientras está bloqueado responde `pin_locked`. Bloqueo por bloques de 5 fallos: 5-9 = 60 s, 10-14 = 5 min, 15-19 = 15 min, 20+ = 30 min.
- **Sincronización**: snapshot completo (configuración + lista). El dispositivo lo guarda de forma atómica en la microSD (`/acl.tmp` → `/acl.json`). Si un UID no está en la lista, no tiene acceso.
- **Cola local (outbox)**: `events/*` y `response` se guardan en `/outbox.json` en la microSD y se reenvían al reconectar (se descartan los más viejos si se llena). `heartbeat` y `status` no se encolan. El backend ignora `id` repetidos.
- **Comandos**: se envían solo si el dispositivo está online (`last_seen` < 90 s), llevan `expires_at` y no se reintentan. Sin `response`, la UI lo marca como fallido.

## Datos (MongoDB)

| Colección | Campos clave | Índices |
|---|---|---|
| `devices` | `device_id`, `name`, `site`, `fw`, `last_seen`, `acl_version` (versiones que reporta el dispositivo), `desired_acl_version`, `acl_hash`, `pending_sync_request_id`, `last_sync_request_at`, `last_sync_at`, `offline_policy`, `stale_acl_hours`, `unlock_ms`, `requires_pin`, `locked`, `location` (lat/lng) | `device_id` único |
| `cardholders` | `name`, `email`, `unit`, `status` | `email` |
| `credentials` | `holder_id`, `uid`, `status`, `valid_from/to`, `revoked_at`, `pin_hash` (Argon2id, opcional), `pin_fails`, `pin_locked_until` | `uid` único entre vigentes (`partialFilterExpression: {status: "active"}`), `holder_id` |
| `enrollments` | `device_id`, `request_id`, `requested_by`, `created_at` | TTL 60 s |
| `access_events` | `device_id`, `ts`, `uid`, `credential_id?`, `decision`, `reason`, `source`, `request_id`, `mqtt_id`, `degraded`, `acl_age_s` | `(device_id, ts)`, TTL 2 años, `mqtt_id` único |
| `audit_logs` | `actor_id`, `action`, `target`, `before/after`, `ip`, `ts` | `ts`, TTL 2 años (`ts_ttl`) |
| `users` | `email`, `password_hash` (Argon2id), `role`, `active`, `last_login_at` | `email` único |

Bases: `safelock_dev`, `safelock_test_<uuid>` (tests), `safelock` (producción).

## Backend

FastAPI + Pydantic v2 + `aiomqtt` + `pymongo.AsyncMongoClient`. Sin ODM. `ruff` + `mypy` + `pytest-asyncio` + `httpx.AsyncClient`.

Estructura prevista en `backend/app/`: `main.py`, `core/`, `api/v1/`, `schemas/`, `db/`, `services/` (`access_decision`, `mqtt_gateway`, `acl_sync`, `audit`, `provisioning`).

Reglas:
- Toda acción administrativa se registra en `audit_logs`. `access_events` solo se agrega (append-only).
- Roles `admin`/`operator` aplicados en el backend. Sin autorregistro. Primer admin por CLI (`python -m app.cli create-user`).
- Nadie puede cambiar su propio rol ni desactivarse. No se puede desactivar ni degradar al último `admin` activo.
- Resetear una contraseña o desactivar una cuenta invalida sus tokens (`token_version` y `active` se validan en cada request).
- `POST /auth/login` tiene bloqueo temporal incremental por email normalizado. El contador se incrementa de forma atómica (`$inc` en pipeline) y se limpia con login correcto; durante bloqueo responde `429` con `Retry-After` y mensaje genérico. Bloqueo por bloques de 5 fallos: 5-9 = 60 s, 10-14 = 5 min, 15-19 = 15 min, 20+ = 30 min. El PIN usa el mismo esquema atómico por credencial.
- `POST /enrollments` rechaza con `409` si el dispositivo ya tiene un enrolamiento activo (`pending`/`scanned` dentro del TTL de 60 s). El TTL se valida también al marcar el escaneo y al confirmar; confirmar uno expirado lo marca `expired` y responde `409`.
- `POST /devices/{id}/unlock` y `POST /devices/{id}/synchronize-access-list` tienen cooldown por dispositivo (5 s y 10 s); la ventana se reclama de forma atómica **antes** de publicar y se libera si falla la publicación. Durante el cooldown responden `429` con `Retry-After`.
- Fuera de `dev`/`test`, el backend falla al arrancar si `JWT_SECRET` es un placeholder o tiene menos de 32 caracteres, si MQTT no usa TLS, si `MQTT_PASSWORD` está vacío o es placeholder, o si `CORS_ORIGINS` incluye `*`. Advierte si `CORS_ORIGINS` incluye localhost o si `MONGODB_URI` no parece autenticada/Atlas. Ningún secreto se pasa por argumento de CLI: se pide por prompt o variable de entorno.
- Los errores `422` no reflejan `input` ni `ctx` (pueden contener passwords, PIN o UID). Las respuestas `500` son genéricas y llevan los headers de seguridad.
- Los listados están paginados (`limit` ≤ 100, `offset` ≤ 10000) y el body HTTP se rechaza con `413` por encima de 64 KiB.
- Un `events/pin-entry` reserva su evento en `access_events` antes de publicar el unlock; el `mqtt_id` único evita que un replay abra la puerta aunque se pierda la caché de dedupe. El backend valida también `valid_from`/`valid_to` del PIN.
- `online` se calcula con `last_seen`. El frontend usa **polling** (~3 s), no WebSocket. Las acciones sensibles (unlock, lock remoto, retirada, vincular PIN, baja de portador/credencial) piden confirmación.
- No guardar secretos reversibles. No correr múltiples workers de uvicorn (el consumidor MQTT vive en el `lifespan`).

| Capacidad | admin | operator |
|---|---|---|
| Ver dashboard, mapa y actividad | sí | sí |
| Abrir cerradura / bloqueo remoto | sí | sí |
| Portadores, credenciales y enrolamiento | sí | sí |
| Configurar dispositivos (políticas, PIN, ubicación, sync) | sí | no |
| Fijar o resetear el PIN de una credencial | sí | sí |
| Añadir o eliminar dispositivos | sí | no |
| Gestionar usuarios y roles | sí | no |
| Ver auditoría | sí | no |


## Frontend

Vite + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind + shadcn/ui. UI solo en modo oscuro y en inglés. El dashboard incluye un mapa Leaflet + Stadia Maps (Alidade Bright, estilo claro); Stadia usa domain auth, sin API key en el repo. El JWT se guarda en `sessionStorage` y las rutas se protegen validando `/auth/me` al cargar. El cliente API vive en `src/lib/api.ts`; la generación desde OpenAPI queda pendiente porque `openapi-typescript` aún exige TypeScript 5 y el proyecto usa TypeScript 7.

Páginas previstas: Login, Dashboard, Cardholders, Devices, Activity, Audit, Users.

Enrolamiento: se inicia en **Cardholders → Add card → Enroll on device** (no en Devices). `POST /enrollments` (TTL 60 s) → el dispositivo envía `events/card-scan` → la UI lo muestra por polling → el admin confirma → se crea la credencial y se sincroniza la lista.

## Firmware

Ya están `net`, `mqtt_transport`, `settings`, `storage`, `acl` (`lib/acl`), `outbox` (`lib/outbox`), `lock`, `display` y `Tasks` (ver `firmware/README.md`). El firmware usa `espMqttClient` (MQTT 3.1.1, TLS y QoS 1): `status` y LWT son retenidos a QoS 1, `heartbeat` va a QoS 0 y `events/*`/`response` van a QoS 1. `espMqttClient` no persiste los paquetes QoS 1 pendientes al reiniciar; la cola local cubre ese vacío.

El firmware maneja `commands/enroll` y `commands/unlock`, publica `events/card-scan` y `events/pin-entry`, y usa el teclado para entrada de PIN (`*` borra, `#` envía, mínimo 6 dígitos). El PIN se valida solo en el backend; el dispositivo nunca lo guarda ni lo valida.

Arranque: NVS → reloj válido → WiFi → hora → MQTT + LWT → publicar `status` → suscribirse a `commands/#` → sincronizar si hace falta → listo. Sin lista cargada, no hay acceso. El CLI serie está disponible en todo momento (se anuncia en cada boot); solo se bloquea el arranque mientras no haya credenciales válidas. El hostname WiFi es `safelock-<device_id>` (se fija antes de `WiFi.mode()`). SNTP se rearma al reconectar WiFi y se reintenta mientras la hora de red sea inválida; MQTT usa esa hora para TLS (un RTC inválido no bloquea TLS) con timeouts de 10 s en TCP y 15 s en el handshake. El outbox se persiste de forma atómica.

## Infra local (sin Docker)

Mosquitto en `127.0.0.1:1883` sin TLS para desarrollo. TLS solo contra EMQX. El simulador usa `mqtt://` y rechaza `mqtts://` a propósito.

Ejemplo de permisos (`safelock.acl`, coherente con la plantilla de EMQX):

```
user svc-backend
topic read  safelock/#
topic write safelock/devices/+/commands/#

pattern write safelock/devices/%u/#
pattern read  safelock/devices/%u/commands/#
```

Variables de entorno del backend: `ENV`, `CORS_ORIGINS`, `MQTT_URL`, `MQTT_TLS`, `MQTT_CA_PATH`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `ACCESS_TOKEN_TTL_MINUTES`. Usar `.env` + `.env.example` (`.env` en `.gitignore`).

## Convenciones

- `.editorconfig`: UTF-8, LF, espacios, 2 de indentación (Python 4). Makefile con tab.
- Commits en inglés (`feat:`, `fix:`, `chore:`, `docs:`). Mensajes al usuario en español.
- Código e identificadores en inglés. Comentarios solo cuando el "por qué" no sea obvio.
- Clases en PascalCase con el nombre de su header, incluidas las siglas (`Rfid`, `Acl`, `MqttTransport`). Variables y funciones en `snake_case`.
- `device_id`: formato `sl-0001`. UID de tarjeta: `AA:BB:CC:DD` en mayúsculas.
- El nombre del proyecto se escribe **Safelock**, no `SafeLock`.
- **Nunca** commitear secretos, `.env`, certificados privados ni `credentials.md`.
- **Nunca** loggear payloads MQTT (pueden contener PIN y UIDs). Loggear `id`, `device_id`, tipo y decisión.
- Cambiar el protocolo = actualizar `docs/protocol.md` + simulador + backend + firmware en el mismo cambio.
- Pruebas obligatorias en: decisión de acceso, parseo de mensajes y sincronización de la lista (snapshot completo, guardado atómico).

## Comandos

```bash
make venv          # crear venv e instalar deps
make backend       # API en desarrollo
make create-user   # crear una cuenta (admin por defecto)
make seed-demo     # sembrar datos de demo (solo dev)
make seed-demo-reset # eliminar datos de demo
make provision PORT=/dev/ttyUSB0 # aprovisionar dispositivo por serie
make firmware      # compilar firmware
make test-firmware # pruebas nativas de validación del firmware
make monitor       # monitor serial
make simulator     # simulador
make test-backend # pruebas backend
make lint          # lint backend
make format        # formatear backend
make frontend      # frontend en desarrollo
make typecheck     # tipos frontend
make mqtt-restart  # reiniciar Mosquitto
```

## Estado

- Fase 0 cerrada: `docs/protocol.md`, ADRs, `Makefile`, scaffold del backend y del frontend, simulador MQTT.
- Hito 1 cerrado: auth JWT, CLI `create-user`, CRUD de portadores, credenciales y dispositivos, auditoría con endpoint de lectura, y frontend de Login, Cardholders, Devices, Audit y Users.
- Hito 2 implementado y verificado con el simulador: firmware con NVS/WiFi/SNTP/MQTT (`status`/`heartbeat` + LWT a QoS 1), gateway MQTT en el `lifespan`, `access_events` y vista Activity. Pendiente de probar en placa y configurar host y CA reales.
- Hito 3 implementado y verificado de punta a punta con el simulador: snapshot completo con guardado atómico en microSD, outbox persistente, decisión local de tarjeta y `access-decision`. El backend actualiza la versión deseada solo cuando cambia el contenido y reenvía al reconectar; el frontend tiene sincronización manual para admin. Pendiente de probar en placa.
- Hito 4 implementado y verificado con el simulador: unlock remoto, enrolamiento por toque y PIN validado en el backend; frontend con unlock remoto y enrolamiento/edición de credenciales en Cardholders. Pendiente de probar en placa.
- Hito 5 cerrado: TTL de `audit_logs` (2 años), lockout incremental y atómico de login/PIN, cooldowns atómicos de unlock/sync, enrolamiento activo con TTL estricto, CORS/headers de seguridad, validación estricta de config y revisión final de hardening (dependencias, endpoints y logs/errores/permisos). Seguimientos no bloqueantes: lockfile de Python con hashes y CI con `pip-audit`/`npm audit`, throttle por IP en login y dedupe atómico de enrolamiento.

## Roadmap

Hitos verticales. Un hito se cierra cuando funciona de punta a punta.

| Hito | Entregable |
|---|---|
| 1. Admin y datos | Base de datos, auth, CLI `create-user`, CRUD de portadores, dispositivos y credenciales, auditoría; scaffold frontend con Login |
| 2. Primer dispositivo en línea | Firmware: NVS, WiFi, hora y MQTT con `status`/`heartbeat`; backend: gateway MQTT que ingiere eventos y los muestra con polling |
| 3. Acceso local-first | Snapshot de ACL con guardado atómico, outbox, decisión local y `access-decision` (verificado con el simulador) |
| 4. Operación remota | `unlock`, enrolamiento por toque y PIN validado en el backend |
| 5. Endurecimiento | Retención y TTL, límites de intentos, mejoras generales de seguridad |

## Fuera de alcance por ahora

- Horarios de acceso.
- Sensor de puerta, botón de salida, UPS y llave mecánica.
- OTA y mejoras de hardware para seguridad de claves.
- Rotación/revocación avanzada de sesiones.
- Validación criptográfica de tarjeta (MIFARE Classic solo usa UID, clonable).

## Prohibiciones

- No volver al esquema "la primera tarjeta es master".
- No guardar ni validar el PIN en el dispositivo.
- No poner el backend en la ruta crítica del acceso por tarjeta.
- No permitir "solo tarjeta" como respaldo en puertas con PIN.
- No usar `setInsecure()` ni certificados sin verificar.
- No confiar en la cola del broker para comandos.
- No añadir Docker.
- No correr múltiples workers de uvicorn.
- No añadir multi-tenencia.
