# ADR 0002: MQTT 3.1.1 sobre TLS con credenciales del broker como autenticación

- **Estado:** aceptado
- **Fecha:** 2026-11-16

## Contexto

Necesitamos confidencialidad, integridad y autenticación entre el dispositivo y el backend, sin sobrecargar el firmware ni reinventar criptografía. El dispositivo es un ESP32 con `PubSubClient`, que solo implementa MQTT 3.1.1.

## Decisión

- **MQTT 3.1.1** (PubSubClient no soporta 5) sobre **TLS 8883** con la **CA fijada** en el dispositivo. Prohibido `setInsecure()`.
- El dispositivo se autentica con **usuario == `device_id`** y su contraseña MQTT (lo exige la plantilla ACL de EMQX).
- **No** hay firma en el payload, ni `nonce`, ni ventana temporal: TLS + credenciales del broker + ACL de topics ya dan confidencialidad, integridad y autenticación.
- `state` retenido + **LWT** para conocer online/offline.
- Aprovisionamiento de credenciales por **serie/USB** una vez, al instalar: sin credencial *factory* ni topic de provisioning.

## Consecuencias

- Menos superficie de ataque: no hay un secreto de fábrica que filtrar ni un canal de aprovisionamiento por red.
- El firmware no necesita bibliotecas de firma.
- El TLS necesita un reloj correcto: se siembra del DS1307 y se corrige por SNTP. Sin RTC válido no se intenta TLS.
- La autenticación depende del broker (EMQX en producción, Mosquitto en local); el backend confía en él para saber qué `device_id` publica.
