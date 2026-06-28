# SDD · 01 · Spec — SomosVenezuela

## Objetivo
Construir una plataforma de **reunificación familiar** para la emergencia del terremoto de Venezuela 2026: registrar y buscar personas y mascotas desaparecidas desde cualquier canal (Telegram, WhatsApp, web), con matching por IA, mapa de zonas/necesidades, mensajes "estoy vivo", agregador de fuentes oficiales y módulo satelital con validación humana. Stack gratuito, construido con Claude Code y SDD, por fases.

## Problema y urgencia
Tras el terremoto hay miles de personas separadas de sus familias, datos dispersos en listas de papel, hospitales, refugios y organizaciones. El objetivo es un **registro central** con búsqueda y matching que funcione **en días**, empezando por el núcleo (registro + búsqueda por Telegram) y creciendo de forma incremental sin parar el servicio.

## Usuarios
- **Familiares que buscan** a una persona o mascota.
- **Personas que avisan** de que están vivas o registran a alguien.
- **Voluntarios** (validan zonas/necesidades y detecciones satelitales).
- **Entidades verificadas** (Cruz Roja, OCHA, hospitales, refugios, plataformas aliadas) que aportan datos y confirman casos sensibles.
- **Equipos de rescate** (consumen alertas satelitales de alta confianza).

## Alcance funcional (módulos)
1. Registro y búsqueda de personas y mascotas (núcleo).
2. Bots de Telegram y WhatsApp (mismo backend y lógica).
3. Motor de IA: matching, OCR de listas en papel, priorización.
4. Mapa de zonas y necesidades.
5. Menores no acompañados (prioritario, verificación reforzada).
6. Mensajes "estoy vivo" (asíncronos).
7. Agregador de fuentes oficiales.
8. Módulo satelital (IA + validación humana → alertas de rescate).
9. Notificaciones transversales.

Detalle por módulo en `specs/` y `docs/specs-modulos.md`.

## Requisitos no funcionales
- **Privacidad y seguridad** como requisito de primer nivel (ver `docs/guardrails.md`).
- **Stack 100% gratuito** (planes free de los servicios listados en `CLAUDE.md`).
- **Disponibilidad**: el servicio crece sin downtime; cada fase es desplegable.
- **Multicanal coherente**: misma lógica y datos para Telegram, WhatsApp y web.
- **Resiliencia**: el sistema debe degradar con elegancia (si falla la IA, el registro/búsqueda manual sigue funcionando).
- **Trazabilidad**: cada registro lleva fuente y estado de verificación.
- **i18n**: español (es-VE) primero.

## Criterios de aceptación globales
- Una persona puede **registrar** y **buscar** por Telegram en < 1 min, sin conocimientos técnicos.
- Toda búsqueda muestra resultados ordenados por probabilidad, con **fuente** y **verificación** visibles.
- Ningún dato de contacto se muestra públicamente en ningún canal.
- Los estados sensibles (`fallecida`, entrega de menor) requieren **fuente verificada** + confirmación humana.
- Existe **borrado** por petición del usuario al bot.
- `pnpm verify` (harness) pasa en verde: typecheck + lint + tests + checks de guardrails.

## Fuera de alcance (v1)
- App móvil nativa (se usa web + bots).
- Traducción a otros idiomas (más adelante).
- Pagos/donaciones dentro de la plataforma.
