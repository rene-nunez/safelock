# AGENTS.md

Memoria del proyecto para agentes. Si algo de este documento contradice una suposición tuya, gana este documento. Si hay que cambiar una decisión de aquí, se cambia aquí en el mismo commit.

## Proyecto

SafeLock: sistema embebido de control de acceso por RFID (MFRC522) + teclado numérico + OLED + RTC, con backend FastAPI, frontend React y MongoDB Atlas. Monorepo.

Hardware actual: ESP32 dev board, MFRC522 por SPI, teclado 4x3, SSD1306 por SPI, DS1307 por I2C. **Falta el actuador**: no hay relé, sensor de puerta ni pulsador de salida todavía.

## Estado del repo (actualizar al cerrar cada fase)

- Firmware PlatformIO en `firmware/` (`src/`, `lib/`, `include/`, `platformio.ini`). Compila con `pio run -d firmware`. `firmware/.vscode/` solo conserva `extensions.json`; `c_cpp_properties.json` y `launch.json` los regenera la extensión PlatformIO.
- `backend/` y `frontend/` existen pero están vacíos.
- No hay `Makefile` todavía: los comandos viven en este documento. Se creará cuando aparezcan scripts que repetir en CI y en local.
- Memoria de agentes: `AGENTS.md`, versionado y compartido con el equipo.
- `.editorconfig` con base global de 2 espacios y solo las excepciones: Python 4 (línea 88), JS/TS línea 100, Makefile con tab, Markdown sin trim.
- `credentials.md` eliminado y usuario de Atlas rotado. **Nunca** volver a commitear credenciales.
- Sin Docker. Mosquitto y MongoDB se usan nativos/Atlas.

## Decisiones de arquitectura (cerradas)

| Área | Decisión |
|---|---|
| Topología | Un solo sitio, N dispositivos, 1 puerta por dispositivo, estado por dispositivo. `site` como documento embebido, no multi-tenant |
| Decisión de acceso | **Local-first**. La ACL en caché del dispositivo decide las tarjetas. El backend es plano de control, nunca está en la ruta crítica del desbloqueo |
| PIN | Verificado **solo en el backend**, sobre TLS. Nunca se cachea ni se compara localmente. ≥6 dígitos |
| Offline | Tarjetas en caché permitidas. PIN denegado. `stale_acl_hours` por puerta (72 h). `offline_policy: allow \| deny` por puerta |
| Enrolamiento | *Claim code* desde OLED/serie → el admin lo ingresa en la web. **Prohibido** "primera tarjeta = master" |
| Broker | EMQX Serverless, MQTT 3.1.1, TLS 8883, ACL en modo lista blanca con `${username}` |
| Comandos | Nunca confiar en la cola del broker (expira a las 2 h). Comandos pendientes en Mongo, se empujan al reconectar |
| Base de datos | Atlas M0. `pymongo.AsyncMongoClient` (Motor está deprecado). Repos planos + Pydantic, sin ODM |
| App web | Solo administración. Roles `admin` (enrolar/revocar) y `operator` (ver/abrir remoto). Sin autorregistro |
| Tiempo real | WebSocket `/ws/events` alimentado por el consumidor MQTT. **Un solo worker de uvicorn** |
| Energía | Actuador de retención (latching), cerradura *fail-secure*, UPS en el controlador, pulsador de salida y llave mecánica |
| Infra | Sin Docker: Mosquitto nativo en dev, Atlas para Mongo |

## Modelo de acceso

La variable relevante no es "hay internet" sino **"¿el dispositivo puede hablar con el backend ahora?"**.

| Escenario | RFID | PIN |
|---|---|---|
| Backend alcanzable | Abre (decide el dispositivo, 50–100 ms) y luego audita | Abre si el backend valida (200–400 ms) |
| Backend no alcanzable | Abre con ACL en caché dentro de `stale_acl_hours`; evento al outbox | Deniega: "sin conexión, use su tarjeta" |

Reparto de autoridad:

| Quién decide | Qué |
|---|---|
| Dispositivo (siempre) | ¿Tarjeta en ACL local, activa, vigente según RTC, no bloqueada? |
| Backend | ¿PIN correcto? ¿Credencial existe/revocada? ¿Apertura remota autorizada? |
| Nadie offline | Enrolar, revocar, cambiar PIN, horarios, OTA |

Reglas derivadas:

- Toda persona debe tener al menos una credencial `card` activa. El PIN es complemento opcional. Se valida en el esquema.
- `requires_pin: true` por puerta = tarjeta + PIN (2FA), solo con conexión. v1 en `false`.
- Tarjeta desconocida → se deniega localmente **pero se publica** (`decision: "unknown"`) para que quede en la auditoría.
- Salud del backend en el dispositivo = timeout de `ack` (3 s) + `hb`. Estar conectado al broker no implica que el backend esté vivo.
- Reloj inválido (pila del DS1307 muerta) → no evaluar vigencias, no intentar TLS, alerta crítica en el siguiente `hb`.

## Contrato MQTT (`docs/protocol.md` es la fuente de verdad)

MQTT **3.1.1** (PubSubClient no soporta 5), QoS 1, TLS 8883, `state` retenido + LWT. **Usuario MQTT == `device_id`** (lo exige la plantilla ACL de EMQX).

| Topic | Dirección | Contenido |
|---|---|---|
| `safelock/v1/dev/{id}/evt/scan` | dev→be | UID + origen |
| `safelock/v1/dev/{id}/evt/pin` | dev→be | `pin_proof` |
| `safelock/v1/dev/{id}/evt/decision` | dev→be | decisión local aplicada |
| `safelock/v1/dev/{id}/state` | dev→be | retenido: online, fw, `acl_version`, cerradura |
| `safelock/v1/dev/{id}/hb` | dev→be | heartbeat 30–60 s |
| `safelock/v1/dev/{id}/cmd/unlock` | be→dev | `request_id`, `duration_ms`, `expires_at` |
| `safelock/v1/dev/{id}/cmd/sync` | be→dev | snapshot de ACL fragmentado |
| `safelock/v1/dev/{id}/ack` | dev→be | `request_id` + resultado |

Sobre de mensaje, idéntico en todos los topics:

```json
{ "v":1, "id":"<uuid4>", "ts":1761..., "device_id":"sl-0001",
  "nonce":"<aleatorio>", "data":{...}, "sig":"<hmac-sha256 hex>" }
```

Validación en el backend: HMAC inválido → descartar; `|ahora - ts| > 120 s` → descartar; `id` duplicado → descartar (índice único + TTL). El `device_secret` se guarda **cifrado y reversible** (`secret_enc`, AES-GCM/Fernet con clave de entorno), porque verificar el HMAC requiere la clave. No existe `secret_hash`.

PIN: el dispositivo envía `pin_proof = HMAC-SHA256(device_secret, "pin:" + pin)`, nunca el PIN en claro. El backend guarda `Argon2id(pin_proof)` y aplica rate limit por credencial y por dispositivo. El prefijo `"pin:"` separa dominios.

Sync de ACL: snapshot versionado con forma de delta desde el día uno.

```json
{ "mode":"full", "acl_version":42, "acl_hash":"sha256:…",
  "part":1, "parts":3, "entries":[…] }
```

- Mensajes ≤ 4 KB (~60 entradas) por el buffer de PubSubClient.
- Commit **atómico** en el dispositivo: partes a archivo temporal en LittleFS, verificar `acl_hash`, luego renombrar y fijar `acl_version`. Nunca aplicar ACL parcial.
- `mode: "delta"` reservado, no implementado en v1. La colección `credential_revocations` (tombstones) existe desde ya.
- Backend limita a ~10 mensajes/s por dispositivo (límite de EMQX Serverless).

Comandos: se crean en Mongo con `expires_at` (30 s). Si el dispositivo está offline, se reintentan en el siguiente `hb` solo si no expiraron; si expiran, `failed`. La UI muestra el estado real, nunca éxito optimista.

## Modelo de datos (MongoDB)

| Colección | Campos clave | Índices |
|---|---|---|
| `devices` | `device_id`, `secret_enc`, `door_id`, `site`, `fw`, `online`, `acl_version`, `last_sync_at`, `offline_policy`, `stale_acl_hours`, `min_acl_version`, `claim_code`, `pending_commands` | `device_id` unique, `claim_code` |
| `doors` | `name`, `device_id`, `unlock_ms`, `schedule_id`, `requires_pin` | `device_id` |
| `cardholders` | `name`, `email`, `unit`, `status` | `email` |
| `credentials` | `holder_id`, `type` (`card`/`pin`), `uid` o `pin_hash`, `status`, `valid_from/to`, `revoked_at`, `essential` | `uid` unique parcial, `holder_id` |
| `credential_revocations` | `uid`, `revoked_at`, `acl_version` | `uid` |
| `access_events` | `device_id`, `ts`, `credential_id`, `decision`, `reason`, `source`, `request_id`, `mqtt_id`, `degraded`, `acl_age_s` | `(device_id, ts)`, TTL 2 años, `mqtt_id` unique |
| `audit_logs` | `actor_id`, `action`, `target`, `before/after`, `ip`, `ts` | `ts` |
| `schedules` | `name`, `windows[]`, `tz` | — |
| `users` | `email`, `password_hash` (Argon2id), `role`, `active`, `last_login_at` | `email` unique |

Bases: `safelock_dev`, `safelock_test_<uuid>` (se crea y borra por corrida de tests), `safelock` en prod.

## Backend

FastAPI + Pydantic v2 + `aiomqtt` (consumidor en el `lifespan`) + `pymongo.AsyncMongoClient`. `ruff` + `mypy` + `pytest-asyncio` + `httpx.AsyncClient`.

```
backend/app/
├── main.py            # app + lifespan (Mongo, tarea MQTT, bus de eventos)
├── core/              # settings, security (JWT/Argon2id), logging, deps
├── api/v1/            # auth users cardholders credentials devices doors events enrollments schedules ws health
├── schemas/           # Pydantic: request/response + sobre MQTT
├── db/                # cliente, índices, repositorios
├── services/          # access_decision, mqtt_gateway, acl_sync, audit, provisioning, realtime
└── workers/           # consumidor MQTT, detector de offline, retención
```

Endpoints: `/auth/{login,refresh,me}`, `/users`, `/cardholders`, `/credentials` (+ `/revoke`), `/enrollments`, `/devices` (+ `/claim`, `/commands/unlock`, `/acl/preview`), `/doors`, `/events` (+ CSV), `/schedules`, `/healthz`, `WS /ws/events`.

Reglas: toda mutación administrativa escribe `audit_logs`; `access_events` es append-only; access token 15 min en memoria, refresh 7 días en cookie `httpOnly`+`Secure`+`SameSite=Strict`; la UI oculta botones pero **el backend verifica el rol** (`require_role`). Primer admin por CLI (`python -m app.cli create-admin`), nunca por endpoint público.

## Frontend

Vite + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind + shadcn/ui. Cliente API generado desde OpenAPI (`openapi-typescript` + `openapi-fetch`): un cambio de esquema del backend debe romper el typecheck del frontend.

Páginas: Login, Dashboard (estado de dispositivos + feed en vivo), Portadores, Enrolar por toque, Dispositivos (claim, versiones fw/ACL, apertura remota), Bitácora (filtros + CSV), Horarios, Auditoría, Usuarios.

Enrolamiento por toque: `POST /enrollments` con TTL 60 s → el `evt/scan` de ese `device_id` se consume como lectura de enrolamiento (no abre la puerta) → la UI recibe el UID por WS → el admin confirma → se crea la credencial y sube `acl_version`. UID duplicado = error explícito.

## Firmware

Pendientes, en este orden:

1. `net` — WiFi con reconexión + **SNTP** (TLS necesita reloj correcto; se siembra del DS1307).
2. `mqtt_client` — `WiFiClientSecure` con **CA fijada**, `setBufferSize(4096)`, LWT, backoff con jitter. Prohibido `setInsecure()`.
3. `config` — credenciales en NVS (`Preferences`), provisión por SoftAP o serie.
4. `outbox` — cola persistente en LittleFS, replay al reconectar, `seq` monotónico.
5. `acl` — lista blanca + versión + contadores de bloqueo de PIN.
6. `lock` — relé, sensor de puerta, pulsador, watchdog, tope de 5 s de apertura.
7. `Tasks` → máquina de estados **no bloqueante** (el handshake TLS bloquea segundos).

Arranque: NVS → ¿RTC válido? → WiFi → SNTP → MQTT (LWT) → `state` retenido → suscribir `cmd/#` → sync si `acl_version` está atrasada → `ENTERING`. Sin ACL cargada no hay acceso (fail closed); el dispositivo nace sin reclamar, así que eso no bloquea la instalación.

## Infra local (sin Docker)

Mosquitto nativo en `127.0.0.1:1883` **sin TLS** para desarrollo; TLS solo se prueba contra EMQX. `/etc/mosquitto/conf.d/safelock.conf`:

```
listener 1883 127.0.0.1
allow_anonymous false
password_file /etc/mosquitto/safelock.passwd
acl_file      /etc/mosquitto/safelock.acl
persistence true
persistence_location /var/lib/mosquitto/
log_dest stdout
```

`safelock.acl` (equivalente a la plantilla de EMQX, para que el firmware se comporte igual en local y en producción):

```
user svc-backend
topic read safelock/v1/#
topic write safelock/v1/dev/+/cmd/#

pattern write safelock/v1/dev/%u/#
pattern read  safelock/v1/dev/%u/cmd/#
```

Variables de entorno del backend: `MQTT_URL`, `MQTT_TLS`, `MQTT_CA_PATH`, `MONGODB_URI`, `MONGODB_DB`, `APP_SECRET_KEY`, `JWT_SECRET`. Siempre `.env` + `.env.example`; `.env` en `.gitignore`.

## Convenciones

- `.editorconfig`: UTF-8, LF, espacios, 2 de indentación, newline final.
- Commits convencionales (`feat:`, `fix:`, `chore:`, `docs:`), en inglés como el historial actual. Mensajes de la conversación con el usuario: español.
- Código e identificadores en inglés; comentarios solo donde el "por qué" no es obvio.
- Nombres: `device_id` tipo `sl-0001`; UID de tarjeta `AA:BB:CC:DD` en mayúsculas con `:`.
- **Nunca** commitear secretos, `.env`, certificados privados ni `credentials.md`.
- **Nunca** loggear payloads MQTT (contienen `pin_proof` y UIDs). Loggear `id`, `device_id`, tipo y decisión.
- Cambiar el protocolo = actualizar `docs/protocol.md` + simulador + backend + firmware en el mismo cambio.
- Tests obligatorios en la capa de decisión (`access_decision`), en el parseo del sobre y en el sync de ACL (commit atómico, hash, partes).

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

**Fase actual: 0.** Firmware ya movido a `firmware/`. Próximo paso concreto: `docs/protocol.md` con los payloads exactos, los tres ADRs y `backend/scripts/simulator.py`.

## Prohibiciones explícitas

- No reintroducir "la primera tarjeta es master".
- No cachear ni verificar el PIN en el dispositivo (v1).
- No poner el backend en la ruta crítica del RFID.
- No usar `setInsecure()` ni certificados sin verificar.
- No confiar en la cola del broker para comandos.
- No añadir Docker a la infra.
- No correr múltiples workers de uvicorn sin Redis pub/sub entre MQTT y WS.
- No añadir multi-tenencia; `site` es un documento embebido.
