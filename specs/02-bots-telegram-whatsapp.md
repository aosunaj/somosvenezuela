# Spec 02 · Bots de Telegram y WhatsApp

## Objetivo
Ofrecer el mismo servicio por chat, con flujo guiado por menús, sobre el mismo backend y base de datos.

## Requisitos funcionales
- Flujos: registrar, buscar, dejar mensaje "estoy vivo", reportar, subir foto de lista, **borrar mi registro**.
- **Telegram primero** (Bot API, sin aprobación). **WhatsApp después** (Cloud API).
- Máquina de conversación **compartida** en `packages/core`; los bots son adaptadores finos (transporte + formato).
- Menús en español, claros para personas no técnicas.

## API/Interfaz
- Telegram: long polling o webhook (`TELEGRAM_WEBHOOK_SECRET`).
- WhatsApp: webhook con verificación de `WHATSAPP_VERIFY_TOKEN` y firma (`WHATSAPP_APP_SECRET`).
- Ambos llaman a los endpoints del backend (Spec 01).

## Reglas y guardrails
- No exponer contacto en ninguna respuesta.
- Validar y sanear toda entrada; rate limiting anti-spam.
- Vincular usuario↔canal en `channels` con `opt_in`.

## Criterios de aceptación
- Un usuario sin conocimientos completa registro y búsqueda por Telegram.
- WhatsApp reutiliza la misma máquina de conversación (test compartido).
- Verificación de firma de webhook WhatsApp probada.

## Dependencias
Spec 01.
