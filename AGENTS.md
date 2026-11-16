# AGENTS.md

Memoria del proyecto para agentes. Si algo de este documento contradice una suposición tuya, gana este documento. Si hay que cambiar una decisión de aquí, se cambia aquí en el mismo commit.

## Proyecto y estado

SafeLock: sistema embebido de control de acceso por RFID (MFRC522) + teclado numérico + OLED + RTC, con backend FastAPI, frontend React y MongoDB Atlas. Monorepo.

Hardware: ESP32 dev board, MFRC522 por SPI, teclado 4x3, SSD1306 por SPI, DS1307 por I2C, LEDs por PCF8574T y buzzer pasivo. Actuador: cerradura electromagnética de 12 V (genérica, sin modelo de referencia) movida por un DRV8871, *fail-secure*: sin energía queda cerrada y solo se libera energizando la bobina. Su contacto seco va a `LOCK_SENSE_PIN` (GPIO34, solo entrada, pull-up externo 10k a 3V3) y **se usa para saber si el pestillo está cerrado o abierto**, con antirrebote en firmware; no mide si la puerta está abierta. El diseño contempla además sensor de puerta, pulsador de salida, UPS en el controlador y llave mecánica, todavía sin implementar.

- `firmware/` es PlatformIO (`src/`, `lib/`, `include/`, `platformio.ini`) y compila con `pio run -d firmware`. Clases en PascalCase con el nombre exacto de su header, `Device` como fachada de arranque y lector RFID que solo identifica (UID de 4–10 bytes); la allowlist temporal vive en `include/config.h`.
- `backend/` y `frontend/` existen pero están vacíos. El `Makefile` de la raíz envuelve los comandos (`make help`).
- Mosquitto nativo en dev y MongoDB Atlas.

## Decisiones de arquitectura (cerradas)

| Área | Decisión |
|---|---|
| Topología | Un solo sitio, N dispositivos, 1 puerta por dispositivo, estado por dispositivo. `site` como documento embebido, no multi-tenant |
| Decisión de acceso | **Local-first**. La ACL en caché del dispositivo decide las tarjetas. El backend es plano de control, nunca está en la ruta crítica del desbloqueo |
| Credenciales | El UID identifica; el PIN es un segundo factor **por tarjeta** |
| PIN | Verificado **solo en el backend**, sobre TLS. Longitud variable (≥6; `#` envía, `*` borra). El dispositivo nunca lo valida ni lo guarda |
| Offline | Tarjetas en caché permitidas. PIN denegado. `stale_acl_hours` por dispositivo (72 h). `offline_policy: allow \| deny` |
| Bloqueo remoto | Flag `locked` en la config del dispositivo: deniega todo el acceso mientras esté activo |
| Enrolamiento | **Por toque**: `cmd/enroll` abre el modo, el UID sube por `evt/scan` y el admin confirma en la web |
| Aprovisionamiento | Por **serie/USB** una vez (device_id + WiFi + credenciales MQTT); sin credencial *factory* |

## Modelo de acceso

La variable relevante no es "hay internet" sino **"¿el dispositivo puede hablar con el backend ahora?"**.

| Escenario | RFID | PIN |
|---|---|---|
| Backend alcanzable | Abre en 50–100 ms con la ACL local y luego audita | Abre si el backend valida (200–400 ms) |
| Backend no alcanzable | Según `offline_policy` y `stale_acl_hours`; evento al outbox | Deniega: PIN no disponible sin conexión |

- **Decide el dispositivo** la tarjeta (en ACL, activa, vigente según RTC). **Decide el backend** el PIN, la revocación y la apertura remota. Offline no se enrola, revoca ni cambia PIN.
- El PIN es **por tarjeta** y opcional; `requires_pin` es por dispositivo y se configura desde la web. Una puerta con PIN es **online-only**: sin backend deniega, sin respaldo "solo UID".
- Bloqueo remoto (`locked`): mientras esté activo el dispositivo deniega **todo** el acceso.
- Tarjeta desconocida: se deniega localmente **pero se publica** (`decision: "unknown"`) para la auditoría.
- Salud del backend = timeout de `ack` (3 s) + `hb`. Estar conectado al broker no implica que el backend esté vivo.
- RTC inválido (pila del DS1307 muerta) → no evaluar vigencias, no intentar TLS, alerta crítica en el siguiente `hb`.

## Contrato MQTT (`docs/protocol.md` es la fuente de verdad)

MQTT **3.1.1** (PubSubClient no soporta 5), QoS 1, TLS 8883, `state` retenido + LWT. **Usuario MQTT == `device_id`** (lo exige la plantilla ACL de EMQX). La autenticación del dispositivo es su credencial MQTT sobre TLS; no hay sobre firmado.

| Topic | Dirección | QoS | Retain | Contenido |
|---|---|---|---|---|
| `safelock/v1/dev/{id}/evt/scan` | dev→be | 1 | no | UID leído en modo enrolamiento |
| `safelock/v1/dev/{id}/evt/pin` | dev→be | 1 | no | PIN tecleado (dentro de TLS) |
| `safelock/v1/dev/{id}/evt/decision` | dev→be | 1 | no | decisión local aplicada |
| `safelock/v1/dev/{id}/state` | dev→be | 1 | **sí** | fw, `acl_version`, `requires_pin`, `locked`, cerradura |
| `safelock/v1/dev/{id}/hb` | dev→be | 0 | no | heartbeat 30–60 s |
| `safelock/v1/dev/{id}/cmd/enroll` | be→dev | 1 | no | `request_id`, `ttl_s`, `expires_at` |
| `safelock/v1/dev/{id}/cmd/unlock` | be→dev | 1 | no | `request_id`, `duration_ms`, `expires_at` |
| `safelock/v1/dev/{id}/cmd/sync` | be→dev | 1 | no | snapshot **completo** de config + ACL |
| `safelock/v1/dev/{id}/ack` | dev→be | 1 | no | `request_id` + resultado |

Sobre de mensaje, idéntico en todos los topics:

```json
{ "v":1, "id":"<uuid4>", "ts":1761000000, "device_id":"sl-0001", "data":{...} }
```

Validación: `id` duplicado → descartar (índice único + TTL). `ts` es la hora del evento en epoch **segundos** (UTC); si el RTC no es válido se usa la hora de recepción y se marca `degraded`. **No hay `sig`, `nonce` ni ventana temporal**: TLS + credenciales del broker + ACL de topics ya dan confidencialidad, integridad y autenticación.

PIN: `evt/pin` lleva el PIN dentro de TLS, igual que un formulario HTTPS. El backend guarda `Argon2id(pin)` y aplica rate limit por tarjeta y por dispositivo, con bloqueo temporal tras 5 fallos.

Sync: snapshot **completo** de configuración + ACL, sin partes ni hash.

```json
{ "acl_version":43, "requires_pin":false, "locked":false, "offline_policy":"allow", "stale_acl_hours":72, "unlock_ms":3000, "entries":[…] }
```

- Un solo mensaje (≈ 8 KB de buffer en PubSubClient). Si algún día no alcanza, se pagina `entries`; no hay `parts` ni `acl_hash`.
- Commit **atómico** en el dispositivo: escribir a archivo temporal en LittleFS y renombrar. Nunca aplicar config/ACL parcial.
- Sin tombstones: el snapshot completo es la verdad; un UID que no aparece está revocado.
- Backend limita a ~10 mensajes/s por dispositivo (límite de EMQX Serverless).

Outbox: `evt/*` y `ack` se encolan de forma **persistente** en LittleFS, con `seq` monotónico y replay al reconectar (descarta los más viejos si se llena). `hb` y `state` no se encolan. El backend deduplica por `id`.

Comandos: se publican solo si el dispositivo está online (`last_seen` < 90 s). Llevan `expires_at` (30 s); si no llega `ack`, la UI lo marca como fallido. Sin cola en Mongo ni reintentos al reconectar.

## Modelo de datos (MongoDB)

| Colección | Campos clave | Índices |
|---|---|---|
| `devices` | `device_id`, `name`, `site`, `fw`, `last_seen`, `acl_version`, `last_sync_at`, `offline_policy`, `stale_acl_hours`, `unlock_ms`, `requires_pin`, `locked` | `device_id` unique |
| `cardholders` | `name`, `email`, `unit`, `status` | `email` |
| `credentials` | `holder_id`, `uid`, `status`, `valid_from/to`, `revoked_at`, `pin_hash` (Argon2id, opcional), `pin_fails`, `pin_locked_until` | `uid` unique, `holder_id` |
| `enrollments` | `device_id`, `request_id`, `requested_by`, `created_at` | TTL 60 s |
| `access_events` | `device_id`, `ts`, `uid`, `credential_id?`, `decision`, `reason`, `source`, `request_id`, `mqtt_id`, `degraded`, `acl_age_s` | `(device_id, ts)`, TTL 2 años, `mqtt_id` unique |
| `audit_logs` | `actor_id`, `action`, `target`, `before/after`, `ip`, `ts` | `ts` |
| `users` | `email`, `password_hash` (Argon2id), `role`, `active`, `last_login_at` | `email` unique |

Bases: `safelock_dev`, `safelock_test_<uuid>` (se crea y borra por corrida de tests), `safelock` en prod.

## Backend

FastAPI + Pydantic v2 + `aiomqtt` (consumidor en el `lifespan`) + `pymongo.AsyncMongoClient` (Atlas M0; Motor está deprecado). Repos planos + Pydantic, sin ODM. `ruff` + `mypy` + `pytest-asyncio` + `httpx.AsyncClient`.

`backend/app/`: `main.py`, `core/`, `api/v1/`, `schemas/`, `db/` y `services/` (`access_decision`, `mqtt_gateway`, `acl_sync`, `audit`, `provisioning`).

Endpoints: `/auth/{login,refresh,me}`, `/users`, `/cardholders`, `/credentials` (+ `/revoke`), `/enrollments`, `/devices` (+ `/commands/enroll`, `/commands/unlock`, `/lock`, `/acl/preview`), `/events` (+ CSV), `/healthz`.

Reglas: mutación administrativa → `audit_logs`; `access_events` append-only; access token 15 min, refresh 7 días en cookie `httpOnly`+`Secure`+`SameSite=Strict`; roles `admin`/`operator` verificados en el backend (`require_role`), sin autorregistro; primer admin por CLI (`python -m app.cli create-admin`), nunca por endpoint público. `online` se deriva de `last_seen` (sin worker); el frontend hace **polling** (~3 s) en lugar de WebSocket, así que no hay pub/sub ni restricción de workers; el dispositivo se autentica en el broker con usuario `device_id` y contraseña, y el backend no guarda secretos reversibles.

## Frontend

Vite + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind + shadcn/ui. Cliente API generado desde OpenAPI (`openapi-typescript` + `openapi-fetch`): un cambio de esquema del backend debe romper el typecheck del frontend.

Páginas: Login, Dashboard (estado de dispositivos + feed por polling), Portadores, Dispositivos (versiones fw/ACL, `requires_pin`, bloqueo, apertura remota), Bitácora (filtros + CSV), Auditoría, Usuarios.

Enrolamiento por toque: `POST /enrollments` con TTL 60 s → el `evt/scan` de ese `device_id` se consume como lectura de enrolamiento (no abre la puerta) → la UI lo recibe por polling → el admin confirma → se crea la credencial y sube `acl_version`. UID duplicado = error explícito. El mismo formulario permite añadir la tarjeta por UID tecleado (vía `cmd/sync`).

## Firmware

Pendientes, en este orden:

1. `net` — WiFi con reconexión + **SNTP** (TLS necesita reloj correcto; se siembra del DS1307).
2. `mqtt_client` — `WiFiClientSecure` con **CA fijada**, `setBufferSize(8192)`, LWT, backoff con jitter. Prohibido `setInsecure()`.
3. `settings` — credenciales en NVS (`Preferences`), provisión por **serie/USB** una vez (device_id + WiFi + credenciales MQTT).
4. `outbox` — cola persistente en LittleFS, replay al reconectar, `seq` monotónico.
5. `acl` — lista blanca + versión, cargada desde un snapshot completo (config + ACL) con commit atómico en LittleFS.
6. `lock` — ya están el DRV8871 (`LOCK_IN1`) y el contacto de pestillo (`LOCK_SENSE_PIN`). Faltan sensor de puerta, pulsador de salida, watchdog y tope duro: el pulso normal es `LOCK_OPEN_MS` (3 s) y el tope de 5 s va con un `esp_timer` independiente del `loop()`, para que no falle si el `loop()` se bloquea.
7. `display` — logo SafeLock (bitmap) al arrancar, prompt de tarjeta y entrada de PIN **sin revelar la longitud** (sin marco de `_`).
8. `Tasks` → máquina de estados **no bloqueante** (el handshake TLS bloquea segundos).

Arranque: NVS → ¿RTC válido? → WiFi → SNTP → MQTT (LWT) → `state` retenido → suscribir `cmd/#` → sync si `acl_version` está atrasada → `ENTERING`. Sin ACL cargada no hay acceso (fail closed).

## Infra local (sin Docker)

Mosquitto nativo en `127.0.0.1:1883` **sin TLS** para desarrollo; TLS solo se prueba contra EMQX. `/etc/mosquitto/conf.d/safelock.conf`: listener 1883, `allow_anonymous false`, `password_file`, `acl_file`, `persistence true`, `log_dest stdout`.

`safelock.acl` (equivalente a la plantilla de EMQX para que el firmware se comporte igual en local y en producción):

```
user svc-backend
topic read safelock/v1/#
topic write safelock/v1/dev/+/cmd/#

pattern write safelock/v1/dev/%u/#
pattern read  safelock/v1/dev/%u/cmd/#
```

Variables de entorno del backend: `MQTT_URL`, `MQTT_TLS`, `MQTT_CA_PATH`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`. Siempre `.env` + `.env.example`; `.env` en `.gitignore`.

## Convenciones

- `.editorconfig`: UTF-8, LF, espacios, 2 de indentación, newline final; Python 4 (línea 88), JS/TS 100, Makefile con tab, Markdown sin trim.
- Commits convencionales (`feat:`, `fix:`, `chore:`, `docs:`) en inglés. Mensajes al usuario: español.
- Código e identificadores en inglés; comentarios solo donde el "por qué" no es obvio.
- Clases en PascalCase y con el nombre exacto de su header (`Display` en `Display.h`, `RFID` en `RFID.h`); variables, parámetros y métodos en `snake_case`.
- `include/pins.h` solo lleva numeración de GPIO y bits del expansor con notas de cableado; polaridades, tiempos y política van en `include/config.h`. El futuro módulo de NVS será `Settings` (`lib/settings/Settings.h`), nunca `config/Config.h`.
- Nombres: `device_id` tipo `sl-0001`; UID de tarjeta `AA:BB:CC:DD` en mayúsculas con `:`.
- **Nunca** commitear secretos, `.env`, certificados privados ni `credentials.md`.
- **Nunca** loggear payloads MQTT (contienen PIN y UIDs). Loggear `id`, `device_id`, tipo y decisión.
- Cambiar el protocolo = actualizar `docs/protocol.md` + simulador + backend + firmware en el mismo cambio.
- Tests obligatorios en `access_decision`, parseo del mensaje y sync de ACL (snapshot completo, commit atómico).

## Comandos

El `Makefile` de la raíz envuelve todo (`make help`):

```bash
make firmware      # pio run -d firmware
make monitor       # pio device monitor -d firmware
make simulator     # python backend/scripts/simulator.py
make test          # pytest backend/tests -q
make lint          # ruff check backend && mypy backend
make frontend      # npm run dev --prefix frontend
make typecheck     # npm run typecheck --prefix frontend
make mqtt-restart  # sudo systemctl restart mosquitto
```

## Fases

| Fase | Entregable |
|---|---|
| 0 | `docs/protocol.md` + ADRs + `Makefile` + scaffolds + simulador |
| 1 | Mongo + auth + CRUD + simulador ↔ login/portadores; firmware: relé y pulsador |
| 2 | Gateway MQTT + decisión + polling; firmware: WiFi + TLS + NTP |
| 3 | Sync de config + ACL + outbox + apertura remota; enrolamiento por toque |
| 4 | Retención, rate limits, OTA, elemento seguro (ATECC608A) o cifrado de flash, fallback celular |

**Fase actual: 0.** Próximo paso: `backend/scripts/simulator.py` y los scaffolds de `backend/` y `frontend/`. Actualizar este archivo al cerrar cada fase.

## Diferido (fuera de v1)

- **Horarios** (`schedules`, `windows[]`, `tz`): no se evalúan en el dispositivo ni viajan en el snapshot.
- **Sensor de puerta**, **pulsador de salida**, **UPS** y **llave mecánica**: contemplados en el hardware, sin implementar.
- **OTA** y **elemento seguro** (ATECC608A) o cifrado de flash.
- **microSD**: el log de acceso local; la auditoría vive en el backend.
- **Refresh token con rotación** y revocación de sesiones.
- **Validación criptográfica de tarjeta**: hoy MIFARE Classic solo valida el UID (clonable).

## Prohibiciones explícitas

- No reintroducir "la primera tarjeta es master".
- No cachear ni verificar el PIN en el dispositivo.
- No poner el backend en la ruta crítica del acceso por tarjeta.
- No permitir respaldo "solo UID" en puertas con PIN: cortar la red no puede saltarse el segundo factor.
- No presentar la validación por UID de MIFARE Classic como segura: es clonable.
- No usar `setInsecure()` ni certificados sin verificar.
- No confiar en la cola del broker para comandos.
- No añadir Docker a la infra.
- No correr múltiples workers de uvicorn: el consumidor MQTT vive en el `lifespan` y se duplicaría.
- No añadir multi-tenencia; `site` es un documento embebido.
