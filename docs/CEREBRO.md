---
tags: [hub, somosvenezuela]
---

# Cerebro — SomosVenezuela

Mapa de navegación del proyecto. Esta nota no tiene contenido propio, solo enlaza.

## Identidad y memoria del proyecto
- [[../CLAUDE.md|CLAUDE]] — memoria del proyecto, principios, stack
- [[../AGENTS.md|AGENTS]] — espejo para otros agentes
- [[../README.md|README]] — índice general
- [[../SOUL.md|SOUL]]

## Flujo SDD
- [[sdd/README-SDD|Mapa del flujo SDD]] — spec → design → plan → tasks → verify, con el agente responsable de cada fase

## Guardrails y verificación
- [[guardrails|Guardrails]] — reglas de seguridad/ética no negociables
- [[harness|Harness]] — `pnpm verify`, evals, CI
- [[tdd-strategy|Estrategia TDD]]

## Módulos (specs)
- [[../specs/01-registro-busqueda|01 · Registro y búsqueda]]
- [[../specs/02-bots-telegram-whatsapp|02 · Bots Telegram/WhatsApp]]
- [[../specs/03-motor-ia|03 · Motor IA (matching)]]
- [[../specs/04-mapa-zonas-necesidades|04 · Mapa de zonas y necesidades]]
- [[../specs/05-menores|05 · Menores (protección reforzada)]]
- [[../specs/06-mensajes-estoy-vivo|06 · Mensajes "estoy vivo"]]
- [[../specs/07-agregador-fuentes|07 · Agregador de fuentes]]
- [[../specs/08-satelital|08 · Módulo satelital]]
- [[../specs/09-notificaciones|09 · Notificaciones]]
- [[specs-modulos|Resumen de specs por módulo]]

## Datos y modelo
- [[data-model|Modelo de datos]]

## Apps
- [[../apps/web/README|Web — README]]

## Automatización y despliegue
- [[automatizacion-plataformas|Automatización de plataformas (MCP)]]
- [[prompts-por-tarea|Prompts por tarea]]
- [[prompts-despliegue|Prompts de despliegue]]
- [[ORDEN-DE-USO|Orden de uso]]

## Orquestador y agentes (repo gentle-ai-config, mismo vault)
- [[../../gentle-ai-config/AGENTES|Mapa de agentes y orquestador]]

## Nota sobre Openclaw
Este proyecto también tiene skills en `.openclaw/skills/` (sdd-apply, sdd-verify, judgment-day...) — es la config específica de este repo para el agente Openclaw, en paralelo a lo que usa Claude Code vía `gentle-ai-config`.

## Volver arriba
- [[../../SUPER-CEREBRO|Súper Cerebro]]
