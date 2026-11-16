# ADR 0003: Sync de ACL como snapshot completo con commit atómico

- **Estado:** aceptado
- **Fecha:** 2026-11-16

## Contexto

El dispositivo necesita mantener su ACL sincronizada con el backend de forma que no quede nunca en un estado parcial, y que un corte de luz en medio de una actualización no lo deje con una ACL corrupta o a medias.

## Decisión

- El backend envía un **snapshot completo** en un solo mensaje (`cmd/sync`): configuración del dispositivo (política, `unlock_ms`) más las `entries` completas.
- El dispositivo hace **commit atómico**: escribe a un archivo temporal en LittleFS y lo renombra. Nunca aplica una ACL parcial.
- **Sin tombstones**: el snapshot completo es la verdad; un UID que no aparece está revocado.
- **Sin `parts` ni `acl_hash`**: si algún día el snapshot no cabe en el buffer (~8 KB), se pagina `entries`; no se trocea el mensaje en partes.
- La configuración de la puerta (`requires_pin`, `locked`, `offline_policy`, `stale_acl_hours`) viaja en el mismo snapshot.

## Consecuencias

- La revocación es trivial: al desaparecer del snapshot, deja de valer.
- No hay estado incremental que se pueda desincronizar.
- El dispositivo siempre tiene un estado coherente, incluso tras un corte de luz a mitad de la escritura.
- El costo es reenviar toda la ACL en cada cambio; aceptable para el tamaño previsto (un sitio, pocos dispositivos).
