# Spec 09 · Notificaciones (transversal)

## Objetivo
Avisar por el canal del usuario cuando hay una coincidencia o alerta, priorizando los casos urgentes.

## Requisitos funcionales
- Al crear un `match` relevante o una `sat_alert`, generar `notifications` y entregarlas por `channels` (Telegram/WhatsApp).
- Priorización: menores y casos urgentes primero.
- Reintentos en fallo; registro de estado (`pendiente`/`enviada`/`fallida`).

## Datos
`notifications`, `channels` (ver `docs/data-model.md`).

## Reglas y guardrails
- Respetar `opt_in` del canal.
- No incluir datos de contacto de terceros en el mensaje.
- Prioridad `alta` para menores/urgentes.

## Criterios de aceptación
- Un match genera notificación al canal correcto, con prioridad respetada y estado registrado (test).

## Dependencias
Spec 01, Spec 02 (canales), Spec 03 (matches), Spec 08 (alertas).
