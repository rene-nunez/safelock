# ADR 0001: Decisión local-first (tarjeta en el dispositivo, PIN en el backend)

- **Estado:** aceptado
- **Fecha:** 2026-11-16

## Contexto

La puerta no puede depender de la red para abrir con tarjeta: si el backend o el enlace fallan, una puerta de solo tarjeta debe seguir funcionando. A la vez, el PIN es un segundo factor y guardar su hash en el dispositivo lo expone a extracción de flash y a fuerza bruta offline.

## Decisión

- La **tarjeta** la decide el **dispositivo** con su ACL en caché (activa y vigente según el RTC). Es la ruta crítica y no depende del backend.
- El **PIN** lo decide **solo el backend**, sobre TLS. El dispositivo nunca lo valida ni lo cachea.
- Las puertas con `requires_pin` son **online-only**: sin backend, deniegan. **No** hay respaldo "solo UID", porque cortar la red sería un bypass del segundo factor.
- La **revocación** y la **apertura remota** también las decide el backend.

## Consecuencias

- Una puerta de solo tarjeta abre en 50–100 ms aunque no haya red (según `offline_policy` y `stale_acl_hours`).
- Una puerta con PIN necesita red para abrir. Es el precio de no guardar el PIN en el dispositivo.
- El backend nunca está en la ruta crítica del acceso por tarjeta.
- Offline no se enrola, no se revoca y no se cambia PIN.
- Un atacante con una tarjeta clonada no puede saltarse el PIN cortando la red.
