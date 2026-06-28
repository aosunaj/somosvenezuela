# Documentación · SomosVenezuela

Documentación completa para construir **SomosVenezuela** — plataforma ciudadana de solidaridad para la emergencia del terremoto de Venezuela 2026, cuya misión es **buscar a los que faltan y reunir a las familias** — con **Claude Code** y SDD. Generada a partir del *Plan Técnico de Desarrollo*. Lema: "Nadie se queda atrás."

## Por dónde empezar
1. Lee **`ORDEN-DE-USO.md`** — el paso a paso (carpeta, cuentas, onboarding, fases).
2. Pon `CLAUDE.md` y `AGENTS.md` en la raíz del repo y la carpeta `docs/` dentro.
3. Sigue los prompts de `prompts-por-tarea.md` en Claude Code.

## Qué hay aquí
| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Memoria del proyecto (stack, estructura, convenciones, principios). Va en la raíz. |
| `AGENTS.md` | Espejo de CLAUDE.md para otros agentes de IA. |
| `ORDEN-DE-USO.md` | Paso a paso para dárselo a Claude Code. |
| `sdd/01-spec.md` | Qué se construye y criterios de aceptación. |
| `sdd/02-design.md` | Arquitectura del sistema. |
| `sdd/03-plan.md` | Fases priorizadas por urgencia + cronograma. |
| `sdd/04-tasks.md` | Tareas por fase (checklist). |
| `sdd/05-verify.md` | Verificación técnica + de guardrails. |
| `data-model.md` | Modelo de datos con clasificación de privacidad por campo. |
| `specs-modulos.md` | Spec breve de cada uno de los 9 módulos. |
| `tdd-strategy.md` | Estrategia de tests (Vitest), módulos en TDD estricto. |
| `guardrails.md` | **Reglas de seguridad/privacidad/ética de obligado cumplimiento.** |
| `harness.md` | El harness de verificación (`pnpm verify`, evals de IA, CI). |
| `automatizacion-plataformas.md` | Cómo el agente provisiona y **fija las env vars** en Supabase/Vercel por MCP (sin trabajo manual). |
| `prompts-por-tarea.md` | Prompts SDD para construir, fase a fase. |
| `prompts-despliegue.md` | Prompts de despliegue por MCP: repo, Supabase, Vercel, Railway/Render, webhooks y verificación. |
| `specs/` | Una spec SDD por módulo (9 archivos), lista para `/sdd-new`. |
| `starter/` | Arranque del repo: `.env.example`, `migrations/0001_init.sql`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `scripts/guardrails-scan.mjs`. Ver `starter/STARTER-README.md`. |

## Decisiones tomadas por defecto (ajústalas si quieres)
- **Monorepo con pnpm** (para compartir backend y datos entre bots y web).
- **Vitest** para tests; **TDD estricto** solo en reglas sensibles (contacto, menores, fallecidos, borrado, matching).
- **Matching híbrido** (pg_trgm primero, Claude en casos dudosos) para ahorrar coste.
- Docs en **español**; código en inglés con textos de usuario en español.
- Lo demás sigue fielmente el Plan Técnico (stack, módulos, fases, cronograma).

## Lo más importante
Es un proyecto 