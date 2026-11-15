# AGENTS.md

Memoria del proyecto para agentes. Si algo de este documento contradice una suposición tuya, gana este documento. Si hay que cambiar una decisión de aquí, se cambia aquí en el mismo commit.

## Proyecto y estado

SafeLock: sistema embebido de control de acceso por RFID (MFRC522) + teclado numérico + OLED + RTC, con backend FastAPI, frontend React y MongoDB Atlas. Monorepo.

Hardware: ESP32 dev board, MFRC522 por SPI, teclado 4x3, SSD1306 por SPI, DS1307 por I2C. **Falta el actuador**: relé, sensor de puerta y pulsador de salida. El diseño usa cerradura *fail-secure* con retención, UPS en el controlador y llave mecánica.

- `firmware/` es PlatformIO (`src/`, `lib/`, `include/`, `platformio.ini`) y compila con `pio run -d firmware`. Clases en PascalCase con el nombre exacto de su header, `Device` como fachada de arranque y lector RFID que solo identifica (UID de 4–10 bytes); la allowlist temporal vive en `include/config.h`.
- `backend/` y `frontend/` existen pero están vacíos. No hay `Makefile` todavía: los comandos viven en este documento.
- Mosquitto nativo en dev y MongoDB Atlas.

## Decisiones de arquitectura (cerradas)

| Área | Decisión |
|---|---|
| Topología | Un solo sitio, N dispositivos, 1 puerta por dispositivo, estado por dispositivo. `site` como documento embebido, no multi-tenant |
| Decisión de acceso | **Local-first**. La ACL en caché del dispositivo decide las tarjetas. El backend es plano de control, nunca está en la ruta crítica del desbloqueo |
| Credenciales | El UID identifica; el PIN es un segundo factor opcional del portador |
| PIN | Verificado **solo en el backend**, sobre TLS. ≥6 dígitos |
| Offline | Tarjetas en caché permitidas. PIN denegado. `stale_acl_hours` por dispositivo (72 h). `offline_policy: allow \| deny` |
| Enrolamiento | *Claim code* desde OLED/serie → el admin lo ingresa en la web |

## Modelo de acceso

La variable relevante no es "hay internet" sino **"¿el dispositivo puede hablar con el backend ahora?"**.

| Escenario | RFID | PIN |
|---|---|---|
| Backend alcanzable | Abre en 50–100 ms con la ACL local y luego audita | Abre si el backend valida (200–400 ms) |
| Backend no alcanzable | Según `offline_policy` y `stale_acl_hours`; evento al outbox | Deniega: "sin conexión, use su tarjeta" |

- **Decide el dispositivo** la tarjeta (en ACL, activa, vigente según RTC). **Decide el backend** el PIN, la revocación y la apertura remota. Offline no se enrola, revoca ni cambia PIN.
- Cada portador necesita al menos una tarjeta activa; el PIN es opcional. `requires_pin` es por dispositivo (v1 `false`).
- Tarjeta desconocida: se deniega localmente **pero se publica** (`decision: "unknown"`) para la auditoría.
- Salud del backend = timeout de `ack` (3 s) + `hb`. Estar conectado al broker no implica que el backend esté vivo.
- RTC inválido (pila del DS1307 muerta) → no evaluar vigencias, no intentar TLS, alerta crítica en el siguiente `hb`.

## Contrato MQTT (`docs/protocol.md` es la fuente de verdad)

MQTT **3.1.1** (PubSubClient no soporta 5), QoS 1, TLS 8883, `state` retenido + LWT. **Usuario MQTT == `device_id`** (lo exige la plantilla ACL de EMQX). La autenticación del dispositivo es su credencial MQTT sobre TLS; no hay sobre firmado.

| Topic | Dirección | Contenido |
|---|---|---|
| `safelock/v1/dev/{id}/evt/scan` | dev→be | UID + origen |
| `safelock/v1/dev/{id}/evt/pin` | dev→be | PIN (dentro de TLS) |
| `safelock/v1/dev/{id}/evt/decision` | dev→be | decisión local aplicada |
| `safelock/v1/dev/{id}/state` | dev→be | retenido: fw, `acl_version`, cerradura |
| `safelock/v1/dev/{id}/hb` | dev→be | heartbeat 30–60 s |
| `safelock/v1/dev/{id}/cmd/unlock` | be→dev | `request_id`, `duration_ms`, `expires_at` |
| `safelock/v1/dev/{id}/cmd/sync` | be→dev | snapshot **completo** de ACL |
| `safelock/v1/dev/{id}/ack` | dev→be | `request_id` + resultado |

Sobre de mensaje, idéntico en todos los topics:

```json
{ "v":1, "id":"<uuid4>", "ts":1761..., "device_id":"sl-0001", "data":{...} }
```

Validación: `id` duplicado → descartar (índice único + TTL). `ts` es la hora del evento; si el RTC no es válido se usa la hora de recepción y se marca `degraded`. **No hay `sig`, `nonce` ni ventana temporal**: TLS + credenciales del broker + ACL de topics ya dan confidencialidad, integridad y autenticación.

PIN: `evt/pin` lleva el PIN dentro de TLS, igual que un formulario HTTPS. El backend guarda `Argon2id(pin)` y aplica rate limit por portador y por dispositivo, con bloqueo temporal tras 5 fallos.

Sync de ACL: snapshot **completo**, sin partes ni hash.

```json
{ "mode":"full", "acl_version":42, "entries":[…] }
```

- Un solo mensaje (≈ 8 KB de buffer en PubSubClient). Si algún día no alcanza, se pagina `entries`; no hay `parts` ni `acl_hash`.
- Commit **atómico** en el dispositivo: escribir a archivo temporal en LittleFS y renombrar. Nunca aplicar ACL parcial.
- Sin tombstones: el snapshot completo es la verdad; un UID que no aparece está revocado.
- Backend limita a ~10 mensajes/s por dispositivo (límite de EMQX Serverless).

Comandos: se publican solo si el dispositivo está online (`last_seen` < 90 s). Llevan `expires_at` (30 s); si no llega `ack`, la UI lo marca como fallido. Sin cola en Mongo ni reintentos al reconectar.

## Modelo de datos (MongoDB)

| Colección | Campos clave | Índices |
|---|---|---|
| `devices` | `device_id`, `name`, `site`, `fw`, `last_seen`, `acl_version`, `last_sync_at`, `offline_policy`, `stale_acl_hours`, `unlock_ms`, `requires_pin`, `schedule_id`, `claim_code` | `device_id` unique, `claim_code` |
| `cardholders` | `name`, `email`, `unit`, `status`, `pin_hash` (Argon2id, opcional), `pin_fails`, `pin_locked_until` | `email` |
| `credentials` | `holder_id`, `uid`, `status`, `valid_from/to`, `revoked_at` | `uid` unique, `holder_id` |
| `enrollments` | `device_id`, `requested_by`, `created_at` | TTL 60 s |
| `access_events` | `device_id`, `ts`, `uid`, `credential_id?`, `decision`, `reason`, `source`, `request_id`, `mqtt_id`, `degraded`, `acl_age_s` | `(device_id, ts)`, TTL 2 años, `mqtt_id` unique |
| `audit_logs` | `actor_id`, `action`, `target`, `before/after`, `ip`, `ts` | `ts` |
| `schedules` | `name`, `windows[]`, `tz` | — |
| `users` | `email`, `password_hash` (Argon2id), `role`, `active`, `last_login_at` | `email` unique |

Bases: `safelock_dev`, `safelock_test_<uuid>` (se crea y borra por corrida de tests), `safelock` en prod.

## Backend

FastAPI + Pydantic v2 + `aiomqtt` (consumidor en el `lifespan`) + `pymongo.AsyncMongoClient` (Atlas M0; Motor está deprecado). Repos planos + Pydantic, sin ODM. `ruff` + `mypy` + `pytest-asyncio` + `httpx.AsyncClient`.

`backend/app/`: `main.py`, `core/`, `api/v1/`, `schemas/`, `db/` y `services/` (`access_decision`, `mqtt_gateway`, `acl_sync`, `audit`, `provisioning`, `realtime`).

Endpoints: `/auth/{login,refresh,me}`, `/users`, `/cardholders`, `/credentials` (+ `/revoke`), `/enrollments`, `/devices` (+ `/claim`, `/commands/unlock`, `/acl/preview`), `/events` (+ CSV), `/schedules`, `/healthz`, `WS /ws/events`.

Reglas: mutación administrativa → `audit_logs`; `access_events` append-only; access token 15 min, refresh 7 días en cookie `httpOnly`+`Secure`+`SameSite=Strict`; roles `admin`/`operator` verificados en el backend (`require_role`), sin autorregistro; primer admin por CLI (`python -m app.cli create-admin`), nunca por endpoint público. `online` se deriva de `last_seen` (sin worker); WS `/ws/events` se alimenta del consumidor MQTT; el dispositivo se autentica en el broker con usuario `device_id` y contraseña, y el backend no guarda secretos reversibles.

## Frontend

Vite + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind + shadcn/ui. Cliente API generado desde OpenAPI (`openapi-typescript` + `openapi-fetch`): un cambio de esquema del backend debe romper el typecheck del frontend.

Páginas: Login, Dashboard (estado de dispositivos + feed en vivo), Portadores, Enrolar por toque, Dispositivos (claim, versiones fw/ACL, apertura remota), Bitácora (filtros + CSV), Horarios, Auditoría, Usuarios.

Enrolamiento por toque: `POST /enrollments` con TTL 60 s → el `evt/scan` de ese `device_id` se consume como lectura de enrolamiento (no abre la puerta) → la UI recibe el UID por WS → el admin confirma → se crea la credencial y sube `acl_version`. UID duplicado = error explícito.

## Firmware

Pendientes, en este orden:

1. `net` — WiFi con reconexión + **SNTP** (TLS necesita reloj correcto; se siembra del DS1307).
2. `mqtt_client` — `WiFiClientSecure` con **CA fijada**, `setBufferSize(8192)`, LWT, backoff con jitter. Prohibido `setInsecure()`.
3. `settings` — credenciales en NVS (`Preferences`), provisión por SoftAP o serie.
4. `outbox` — cola persistente en LittleFS, replay al reconectar, `seq` monotónico.
5. `acl` — lista blanca + versión, cargada desde un snapshot completo con commit atómico en LittleFS.
6. `lock` — relé, sensor de puerta, pulsador, watchdog, tope de 5 s de apertura.
7. `Tasks` → máquina de estados **no bloqueante** (el handshake TLS bloquea segundos).

Arranque: NVS → ¿RTC válido? → WiFi → SNTP → MQTT (LWT) → `state` retenido → suscribir `cmd/#` → sync si `acl_version` está atrasada → `ENTERING`. Sin ACL cargada no hay acceso (fail closed); el dispositivo nace sin reclamar, así que eso no bloquea la instalación.

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

```bash
pio run -d firmware                     # compilar firmware
pio device monitor -d firmware          # monitor serie
python backend/scripts/simulator.py     # ESP32 falso (2 dispositivos)
pytest backend/tests -q                 # tests backend
ruff check backend && mypy backend      # lint backend
npm run dev --prefix frontend           # frontend
npm run typecheck --prefix frontend
sudo systemctl restart mosquitto
```

## Fases

| Fase | Entregable |
|---|---|
| 0 | `protocol.md` + ADRs + `Makefile` + scaffolds + simulador |
| 1 | Mongo + auth + CRUD + simulador ↔ login/portadores; firmware: relé y pulsador |
| 2 | Gateway MQTT + decisión + WS; firmware: WiFi + TLS + NTP |
| 3 | Sync de ACL + denylist + outbox + apertura remota; enrolamiento por toque |
| 4 | Retención, rate limits, OTA, elemento seguro (ATECC608A) o cifrado de flash, fallback celular |

**Fase actual: 0.** Próximo paso: `docs/protocol.md` con los payloads exactos, los tres ADRs y `backend/scripts/simulator.py`. Actualizar este archivo al cerrar cada fase.

## Prohibiciones explícitas

- No reintroducir "la primera tarjeta es master".
- No cachear ni verificar el PIN en el dispositivo (v1).
- No poner el backend en la ruta crítica del RFID.
- No usar `setInsecure()` ni certificados sin verificar.
- No confiar en la cola del broker para comandos.
- No añadir Docker a la infra.
- No correr múltiples workers de uvicorn sin Redis pub/sub entre MQTT y WS.
- No añadir multi-tenencia; `site` es un documento embebido.
