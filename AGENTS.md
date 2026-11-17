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
| Bajas | Credenciales y dispositivos se **revocan o retiran**; el borrado duro solo se permite sin historial (credencial sin `access_events`, dispositivo que nunca se conectó). Baja del portador revoca todas sus credenciales |
| Sin conexión | Tarjetas: según `offline_policy` y `stale_acl_hours` (72 h). PIN: siempre denegado sin backend |
| Bloqueo remoto | `locked: true` en la configuración: el dispositivo niega todo acceso |
| Enrolamiento | **Por toque**: el backend inicia el modo, el dispositivo envía el UID leído y el admin confirma en la web |
| Instalación | Credenciales iniciales por **serie/USB** una sola vez (device_id, WiFi, MQTT). Sin credencial de fábrica |
| Roles | `admin`: usuarios, configuración de dispositivos y auditoría. `operator`: operación diaria (ver, abrir, portadores, credenciales, enrolamiento) |
| Mapa | Leaflet + Stadia Maps (Alidade Smooth Dark). UI solo en modo oscuro. Ubicación manual por dispositivo |

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
- RTC inválido: no se evalúan vigencias ni se intenta TLS; se reporta en el `heartbeat`.

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
- **PIN**: viaja en `events/pin-entry` dentro de TLS. El backend guarda `Argon2id(pin)` y aplica límites de intentos (bloqueo temporal tras 5 fallos).
- **Sincronización**: snapshot completo (configuración + lista). El dispositivo lo guarda de forma atómica (archivo temporal en LittleFS y renombre). Si un UID no está en la lista, no tiene acceso.
- **Cola local (outbox)**: `events/*` y `response` se guardan en LittleFS y se reenvían al reconectar (se descartan los más viejos si se llena). `heartbeat` y `status` no se encolan. El backend ignora `id` repetidos.
- **Comandos**: se envían solo si el dispositivo está online (`last_seen` < 90 s), llevan `expires_at` y no se reintentan. Sin `response`, la UI lo marca como fallido.

## Datos (MongoDB)

| Colección | Campos clave | Índices |
|---|---|---|
| `devices` | `device_id`, `name`, `site`, `fw`, `last_seen`, `acl_version`, `last_sync_at`, `offline_policy`, `stale_acl_hours`, `unlock_ms`, `requires_pin`, `locked`, `location` (lat/lng) | `device_id` único |
| `cardholders` | `name`, `email`, `unit`, `status` | `email` |
| `credentials` | `holder_id`, `uid`, `status`, `valid_from/to`, `revoked_at`, `pin_hash` (Argon2id, opcional), `pin_fails`, `pin_locked_until` | `uid` único entre vigentes (`partialFilterExpression: {status: "active"}`), `holder_id` |
| `enrollments` | `device_id`, `request_id`, `requested_by`, `created_at` | TTL 60 s |
| `access_events` | `device_id`, `ts`, `uid`, `credential_id?`, `decision`, `reason`, `source`, `request_id`, `mqtt_id`, `degraded`, `acl_age_s` | `(device_id, ts)`, TTL 2 años, `mqtt_id` único |
| `audit_logs` | `actor_id`, `action`, `target`, `before/after`, `ip`, `ts` | `ts` |
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
- `online` se calcula con `last_seen`. El frontend usa **polling** (~3 s), no WebSocket.
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

Vite + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind + shadcn/ui. UI solo en modo oscuro y en inglés. El dashboard incluye un mapa Leaflet + Stadia Maps (Alidade Smooth Dark); Stadia usa domain auth, sin API key en el repo. El JWT se guarda en `sessionStorage` y las rutas se protegen validando `/auth/me` al cargar. El cliente API vive en `src/lib/api.ts`; la generación desde OpenAPI queda pendiente porque `openapi-typescript` aún exige TypeScript 5 y el proyecto usa TypeScript 7.

Páginas previstas: Login, Dashboard, Cardholders, Devices, Activity, Audit, Users.

Enrolamiento: `POST /enrollments` (TTL 60 s) → el dispositivo envía `events/card-scan` → la UI lo muestra por polling → el admin confirma → se crea la credencial y se sincroniza la lista.

## Firmware

Pendientes, en orden:
1. `net`: WiFi con reconexión + hora de red (SNTP).
2. `mqtt_client`: TLS con CA fija, LWT, reconexión. Prohibido `setInsecure()`.
3. `settings`: credenciales en NVS, provisión por serie/USB una vez.
4. `outbox`: cola persistente en LittleFS con reenvío al reconectar.
5. `acl`: lista de acceso + versión desde snapshot completo, guardado atómico.
6. `lock`: control de cerradura y sensor de pestillo (ya hay base), apertura manual detectada por sensor, topes de seguridad.
7. `display`: interfaz en OLED (sin mostrar cuántos dígitos tiene el PIN).
8. `Tasks`: máquina de estados no bloqueante.

Arranque: NVS → reloj válido → WiFi → hora → MQTT + LWT → publicar `status` → suscribirse a `commands/#` → sincronizar si hace falta → listo. Sin lista cargada, no hay acceso.

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

Variables de entorno del backend: `MQTT_URL`, `MQTT_TLS`, `MQTT_CA_PATH`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`. Usar `.env` + `.env.example` (`.env` en `.gitignore`).

## Convenciones

- `.editorconfig`: UTF-8, LF, espacios, 2 de indentación (Python 4). Makefile con tab.
- Commits en inglés (`feat:`, `fix:`, `chore:`, `docs:`). Mensajes al usuario en español.
- Código e identificadores en inglés. Comentarios solo cuando el "por qué" no sea obvio.
- Clases en PascalCase con el nombre de su header. Variables y funciones en `snake_case`.
- `device_id`: formato `sl-0001`. UID de tarjeta: `AA:BB:CC:DD` en mayúsculas.
- El nombre del proyecto se escribe **Safelock**, no `SafeLock`.
- **Nunca** commitear secretos, `.env`, certificados privados ni `credentials.md`.
- **Nunca** loggear payloads MQTT (pueden contener PIN y UIDs). Loggear `id`, `device_id`, tipo y decisión.
- Cambiar el protocolo = actualizar `docs/protocol.md` + simulador + backend + firmware en el mismo cambio.
- Pruebas obligatorias en: decisión de acceso, parseo de mensajes y sincronización de la lista (snapshot completo, guardado atómico).

## Comandos

```bash
make venv          # crear venv e instalar deps
make api           # API en desarrollo
make create-user   # crear una cuenta (admin por defecto)
make seed-demo     # sembrar datos de demo (solo dev)
make seed-demo-reset # eliminar datos de demo
make firmware      # compilar firmware
make monitor       # monitor serial
make simulator     # simulador
make test          # pruebas backend
make lint          # lint backend
make format        # formatear backend
make frontend      # frontend en desarrollo
make typecheck     # tipos frontend
make mqtt-restart  # reiniciar Mosquitto
```

## Estado

- Fase 0 cerrada: `docs/protocol.md`, ADRs, `Makefile`, scaffold del backend y del frontend, simulador MQTT.
- Hito 1 cerrado: auth JWT, CLI `create-user`, CRUD de portadores, credenciales y dispositivos, auditoría con endpoint de lectura, y frontend de Login, Cardholders, Devices, Audit y Users.

## Roadmap

Hitos verticales. Un hito se cierra cuando funciona de punta a punta.

| Hito | Entregable |
|---|---|
| 1. Admin y datos | Base de datos, auth, CLI `create-user`, CRUD de portadores, dispositivos y credenciales, auditoría; scaffold frontend con Login |
| 2. Primer dispositivo en línea | Firmware: NVS, WiFi, hora y MQTT con `status`/`heartbeat`; backend: gateway MQTT que ingiere eventos y los muestra con polling |
| 3. Acceso local-first | Snapshot de ACL con guardado atómico, outbox, decisión local y `access-decision` (el simulador ya permite probarlo) |
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
