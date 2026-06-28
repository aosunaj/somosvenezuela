# AGENTS.md — SomosVenezuela

Archivo de contexto para agentes de IA (Claude Code, Cursor, OpenCode, Gemini, etc.). **Es un espejo del `CLAUDE.md`**: si editas uno, refleja el cambio en el otro (gentle-ai los sincroniza por agente al hacer `gentle-ai sync`).

## Resumen para el agente
**SomosVenezuela**: plataforma ciudadana de solidaridad para el terremoto de Venezuela 2026; misión = buscar a los que faltan y reunir a las familias (lema "Nadie se queda atrás"). Monorepo TypeScript (pnpm): Fastify + Supabase, bots Telegram/WhatsApp, web React, IA con Claude. Se construye con SDD por fases.

## Reglas que SIEMPRE debes respetar
1. **Vidas > velocidad > funcionalidades.**
2. **Privacidad first**: nunca expongas teléfonos/contacto; mínimo de datos; nada de PII real en código/tests/logs/prompts.
3. **Menores**: verificación reforzada; solo entidades verificadas confirman entregas.
4. **Fallecimientos**: solo con fuente fiable; por defecto `sin_verificar`.
5. **IA sugiere, humano confirma** en todo lo sensible (matching, satélite, fallecimiento, menores).
6. **Derecho al borrado** y **respeto a términos de fuentes** (cita el origen).
7. Valida toda entrada con **zod**; TypeScript estricto sin `any`.

## Cómo trabajar
- Lee `docs/sdd/` y `specs/<módulo>.md` antes de implementar.
- Sigue el orden de fases de `docs/sdd/03-plan.md`.
- Flujo: spec → plan → apply → verify. Pasa `pnpm verify` y revisa `docs/guardrails.md` antes de cerrar.
- No introduzcas dependencias de pago ni servicios fuera del stack gratuito definido en `CLAUDE.md`.

## Detalle completo
Ver `CLA