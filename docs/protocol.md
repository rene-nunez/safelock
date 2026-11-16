# Protocolo SafeLock v1

Contrato MQTT entre los dispositivos (ESP32) y el backend. **Este documento es la fuente de verdad**: cambiar el protocolo implica actualizar este archivo, el simulador, el backend y el firmware en el mismo cambio.

## Transporte

- MQTT **3.1.1** (PubSubClient no soporta 5), **QoS 1**, **TLS 8883** con la CA fijada en el dispositivo. Prohibido `setInsecure()`.
- `state` se publica **retenido** y el dispositivo registra un **LWT**, para que el broker lo marque offline al desconectarse.
- El dispositivo se autentica en el broker con **usuario == `device_id`** y su contraseña. No hay firma en el payload: TLS + credenciales del broker + ACL de topics dan confidencialidad, integridad y autenticación.

## Sobre de mensaje

Todos los topics usan el mismo sobre:

```json
{ "v": 1, "id": "<uuid4>", "ts": 1761000000, "device_id": "sl-0001", "data": {} }
```

| Campo | Tipo | Notas |
|---|---|---|
| `v` | int | Versión del protocolo. Hoy `1`. |
| `id` | string | UUID4 único. Un `id` duplicado se descarta (índice único + TTL en el backend). |
| `ts` | int | Epoch en **segundos** (UTC). Si el RTC del dispositivo no es válido se usa la hora de recepción y el evento se marca `degraded`. |
| `device_id` | string | Formato `sl-0001`. Debe coincidir con el usuario MQTT. |
| `data` | object | Específico del topic. |

## Topics

| Topic | Dirección | QoS | Retain | Contenido |
|---|---|---|---|---|
| `safelock/v1/dev/{id}/evt/scan` | dev→be | 1 | no | UID leído en modo enrolamiento |
| `safelock/v1/dev/{id}/evt/pin` | dev→be | 1 | no | PIN tecleado (dentro de TLS) |
| `safelock/v1/dev/{id}/evt/decision` | dev→be | 1 | no | Decisión aplicada por el dispositivo |
| `safelock/v1/dev/{id}/state` | dev→be | 1 | **sí** | Estado retenido: fw, ACL, política, cerradura |
| `safelock/v1/dev/{id}/hb` | dev→be | 0 | no | Heartbeat |
| `safelock/v1/dev/{id}/cmd/enroll` | be→dev | 1 | no | Entrar en modo enrolamiento |
| `safelock/v1/dev/{id}/cmd/unlock` | be→dev | 1 | no | Apertura remota o tras validar el PIN |
| `safelock/v1/dev/{id}/cmd/sync` | be→dev | 1 | no | Snapshot **completo** de configuración + ACL |
| `safelock/v1/dev/{id}/ack` | dev→be | 1 | no | Resultado de un comando |

## Payloads

### `evt/scan`

Se publica **solo** en modo enrolamiento, cuando el dispositivo lee una tarjeta tras un `cmd/enroll`. Esa lectura **no abre la puerta**.

```json
{ "uid": "AA:BB:CC:DD", "request_id": "<uuid4>" }
```

`request_id` es el del `cmd/enroll` que abrió el modo. El backend lo usa para asociar la lectura con el enrolamiento pendiente.

### `evt/pin`

Se publica cuando el portador termina de teclear el PIN en una puerta con `requires_pin`.

```json
{ "uid": "AA:BB:CC:DD", "pin": "123456", "request_id": "<uuid4>" }
```

El `request_id` es nuevo (lo genera el dispositivo) y el backend lo devuelve en el `cmd/unlock` para correlacionar la respuesta.

### `evt/decision`

La publica el dispositivo **siempre** que aplica una decisión de acceso, y también en la apertura manual (que no es una decisión de acceso).

```json
{
  "decision": "granted",
  "reason": "acl_match",
  "source": "card",
  "uid": "AA:BB:CC:DD",
  "credential_id": "<objectid>",
  "acl_version": 42,
  "acl_age_s": 120
}
```

- `decision` es el resultado: `granted`, `denied` o `unknown`.
- `reason` dice **por qué** y va siempre. En los `granted` se deduce de `source`, pero se mantiene por uniformidad; en los `denied` es la única forma de saber la causa.
- `source` es qué se presentó: `card` (solo tarjeta), `pin` (tarjeta + PIN), `remote` (apertura remota) o `manual` (apertura manual).
- `uid` y `credential_id` solo aparecen si hubo tarjeta, y `credential_id` solo si además está en la ACL.
- `acl_age_s` es la antigüedad de la ACL aplicada, en segundos.

Tarjeta fuera de la ACL (desconocida o revocada, el dispositivo no puede distinguirlas): `decision: "denied"`, `reason: "acl_absent"`.

Apertura manual (llave o switch del pestillo): el dispositivo ve el pestillo abrirse sin haber energizado la bobina, avisa en la OLED y el buzzer, y publica:

```json
{ "decision": "unknown", "reason": "manual_open", "source": "manual" }
```

`unknown` significa "no se aplicó ninguna decisión de acceso"; por eso no lleva `uid` ni `credential_id`.

### `state`

Retenido. El dispositivo lo republica al conectar y cuando cambia algo relevante. El **LWT** publica el mismo topic con `online: false`.

```json
{
  "online": true,
  "fw": "0.1.0",
  "acl_version": 42,
  "requires_pin": false,
  "locked": false,
  "lock": "locked"
}
```

- `locked` es el bloqueo remoto (lockdown): con `true` el dispositivo deniega todo el acceso.
- `lock` es el estado físico del pestillo: `locked` o `unlocked`.

### `hb`

Heartbeat cada 30–60 s, QoS 0 (si se pierde uno, no importa).

```json
{ "uptime_s": 1234, "rssi": -58, "rtc_valid": true, "free_heap": 180000 }
```

`rtc_valid: false` es la alerta crítica: sin reloj no se evalúan vigencias ni se intenta TLS.

### `cmd/enroll`

Abre el modo enrolamiento en el dispositivo por `ttl_s` segundos.

```json
{ "request_id": "<uuid4>", "ttl_s": 60, "expires_at": 1761000060 }
```

### `cmd/unlock`

```json
{ "request_id": "<uuid4>", "duration_ms": 3000, "expires_at": 1761000030 }
```

`request_id` correlaciona con el `ack`. `duration_ms` es el pulso de la cerradura; `expires_at` es el vencimiento del comando (30 s).

### `cmd/sync`

Snapshot **completo** de la configuración del dispositivo y su ACL. Un solo mensaje, commit atómico.

```json
{
  "acl_version": 43,
  "requires_pin": false,
  "locked": false,
  "offline_policy": "allow",
  "stale_acl_hours": 72,
  "unlock_ms": 3000,
  "entries": [
    {
      "uid": "AA:BB:CC:DD",
      "credential_id": "<objectid>",
      "holder_id": "<objectid>",
      "status": "active",
      "valid_from": 1761000000,
      "valid_to": null
    }
  ]
}
```

- `entries` es la lista **completa**: un UID que no aparece está revocado (no hay tombstones).
- `requires_pin` y `locked` son la política de esa puerta; el dispositivo las aplica.
- `offline_policy`: `allow` o `deny`.
- `stale_acl_hours`: a partir de cuántas horas sin sincronizar la ACL deja de considerarse válida.
- `valid_from` / `valid_to`: epoch en segundos, o `null`.

### `ack`

```json
{ "request_id": "<uuid4>", "result": "ok", "reason": null }
```

- `result`: `ok`, `error` o `expired`.
- `reason` es opcional (p. ej. `acl_write_failed`).

## Enumeraciones

| Campo | Valores |
|---|---|
| `decision` | `granted`, `denied`, `unknown` (`unknown` = no se aplicó ninguna decisión de acceso) |
| `source` | `card`, `pin`, `remote`, `manual` |
| `reason` | `acl_match`, `acl_absent`, `acl_stale`, `expired`, `not_yet_valid`, `offline_no_pin`, `door_locked`, `pin_ok`, `pin_bad`, `pin_locked`, `no_pin_set`, `rtc_invalid`, `backend_unreachable`, `remote`, `manual_open` |
| `lock` | `locked`, `unlocked` |
| `ack.result` | `ok`, `error`, `expired` |
| `offline_policy` | `allow`, `deny` |

## Decisiones y offline

- **Tarjeta** la decide el dispositivo con la ACL en caché (activa y vigente según RTC). Es la ruta crítica y no depende del backend.
- **PIN** lo decide el backend. El dispositivo nunca valida el PIN.
- Las **puertas con `requires_pin`** son **online-only**: si el backend no responde, deniegan (`offline_no_pin`). No hay respaldo "solo UID", porque cortar la red sería un bypass del segundo factor.
- Con el backend inalcanzable, las puertas de solo tarjeta aplican `offline_policy` y `stale_acl_hours`.
- Tarjeta fuera de la ACL: se deniega localmente (`decision: "denied"`, `reason: "acl_absent"`) **pero se publica**.
- Apertura manual (llave o switch del pestillo): el pestillo se abre sin que el dispositivo energice la bobina. Se avisa localmente (OLED + buzzer) y se publica `decision: "unknown"`, `source: "manual"`, `reason: "manual_open"`. Sin energía no se registra.
- Bloqueo remoto (`locked: true`): deniega todo el acceso.
- RTC inválido: no se evalúan vigencias ni se intenta TLS; alerta en el `hb`.

## Encolado de eventos

Los mensajes `evt/*` y `ack` se encolan de forma **persistente** en LittleFS y se reintentan al reconectar, con un `seq` monotónico. Si la cola se llena se descartan los más viejos. `hb` y `state` **no** se encolan. El backend deduplica por `id`, así que los reintentos son seguros.

## Límites

- Buffer de `cmd/sync` ≈ 8 KB en PubSubClient. Si no alcanza, se pagina `entries` (no hay `parts` ni `acl_hash`).
- ~10 mensajes/s por dispositivo (límite de EMQX Serverless).
- Comandos: solo se publican si el dispositivo está online (`last_seen` < 90 s), llevan `expires_at` (30 s) y no se reintentan al reconectar. Si no llega `ack`, la UI lo marca como fallido.

## Seguridad

- TLS con CA fijada; sin `setInsecure()`.
- PIN verificado **solo en el backend**: `Argon2id`, longitud variable (≥6), rate limit por tarjeta y por dispositivo, bloqueo temporal tras 5 fallos.
- PIN de longitud variable; la OLED **no revela** cuántos dígitos tiene.
- El dispositivo no guarda secretos reversibles: solo la ACL y su configuración.
- **MIFARE Classic solo valida el UID, que es clonable.** No es una validación recomendada; para producción usar tarjetas con autenticación cifrada (DESFire EV2/EV3) o un elemento seguro.
