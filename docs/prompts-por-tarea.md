# Prompts por tarea — SomosVenezuela (Claude Code + SDD)

> Pega los prompts en orden en el chat de Claude Code. Flujo gentle/SDD: `/sdd-onboard` una vez, luego `/sdd-new` por módulo (revisar plan → `/sdd-apply` → `/sdd-verify`). Para tareas pequeñas, `/sdd-ff`. La documentación (`CLAUDE.md`, `docs/`, `specs/`) va en el repo; los prompts en el chat. **Antes de cerrar cada tarea: `pnpm verify` y repasar `docs/guardrails.md`.**

---

## Prompt 0 — Onboarding (una vez)
```
/sdd-onboard

Este repo es "SomosVenezuela", una plataforma humanitaria de reunificación familiar (terremoto Venezuela 2026). Lee CLAUDE.md, AGENTS.md, docs/sdd/, docs/data-model.md, docs/specs-modulos.md, docs/guardrails.md, docs/tdd-strategy.md y docs/harness.md. Es un monorepo pnpm (apps: backend Fastify, web React, bot-telegram, bot-whatsapp; packages: core, db, ai). Prioridad: vidas > velocidad > funcionalidades, y los guardrails están por encima de todo. Cuando termines, confírmame que has cargado la spec y dame el plan de la Fase 0.
```

## Prompt Fase 0 — Scaffold + cimientos
```
/sdd-new Fase 0: scaffold del monorepo y cimientos

Crea:
- Monorepo pnpm con apps/{backend,web,bot-telegram,bot-whatsapp} y packages/{core,db,ai}.
- TypeScript estricto (sin any), ESLint, Vitest. Script raíz `pnpm verify` (typecheck + lint + test + guardrails:scan + db:check) según docs/harness.md.
- packages/core: enums (estado, fuente, verificacion) y esquemas zod base.
- packages/db: cliente Supabase, migración inicial vacía, repositorios base y seeds SINTÉTICOS.
- guardrails:scan inicial (detecta secretos/PII y contacto en payloads).
No incluyas secretos; usa .env (ignorado). Propón el plan, lo reviso y seguimos con /sdd-apply y /sdd-verify.
```

## Prompt Fase 1 — Registro y búsqueda de personas (núcleo)
```
/sdd-new Registro y búsqueda de personas

Sigue specs-modulos.md §1 y data-model.md. Implementa:
- Migración de persons, searches, contacts, sources, channels (con RLS en contacts/channels).
- Endpoints Fastify: alta de persona, alta de búsqueda, búsqueda por nombre/zona/descripción con pg_trgm ordenada por score.
- Reglas de dominio en packages/core: estado por defecto desaparecida, verificacion sin_verificar, y que NINGÚN output incluya contacto.
TDD estricto en: ocultación de contacto y gate de fallecida. Pasa pnpm verify antes de cerrar.
```

## Prompt Fase 2 — Bot de Telegram
```
/sdd-new Bot de Telegram

Sigue specs-modulos.md §2. Implementa la máquina de conversación compartida en packages/core (registrar, buscar, dejar mensaje, reportar, subir foto de lista, BORRAR mi registro) y el adaptador apps/bot-telegram (Bot API) que la consume. Menús en español, claros para gente no técnica. Mismo backend/BD que la web. Tests del flujo de conversación con transporte mockeado. pnpm verify.
```

## Prompt Fase 3 — Motor de IA (matching + OCR + prioridad)
```
/sdd-new Motor de IA: matching, OCR y priorización

Sigue specs-modulos.md §3, harness.md (eval) y guardrails.md. Implementa packages/ai:
- Matching híbrido: normalización + pg_trgm primero; Claude solo en casos dudosos; devuelve matches con score y metodo. NUNCA auto-confirma casos sensibles (estado_revision=propuesto).
- OCR de listas en papel con Claude Vision → registros sin_verificar.
- Priorización (menores, mayores, heridos).
- Eval con set sintético dorado (pnpm ai:eval) y test de degradación sin IA.
pnpm verify + pnpm ai:eval.
```

## Prompt Fase 4 — Bot de WhatsApp
```
/sdd-new Bot de WhatsApp (Cloud API)

Sigue specs-modulos.md §2. Implementa apps/bot-whatsapp reutilizando la máquina de conversación de packages/core. Webhooks con verificación de firma, manejo de límites de la Cloud API, mismos flujos que Telegram. Tests del flujo. pnpm verify.
```

## Prompt Fase 5 — Web + mapa
```
/sdd-new Web pública + mapa de zonas

Sigue specs-modulos.md §1 y §4. apps/web (React+Vite+Tailwind): búsqueda pública con fuente/verificación visibles y SIN exponer contacto; mapa Leaflet+OSM con zonas y necesidades (zones, needs) editables por voluntarios. Tests de que la web nunca muestra contacto. pnpm verify.
```

## Prompt Fase 6 — Menores + mascotas
```
/sdd-ff Menores y mascotas

Sigue specs-modulos.md §5 y §1, guardrails.md §2. Implementa: tabla minors enlazada a persons con gate de entrega_confirmada (solo entidad verificada) en TDD estricto + prioridad máxima en matching; y pets (alta/búsqueda/matching reutilizando el núcleo). pnpm verify.
```

## Prompt Fase 7 — "Estoy vivo" + agregador de fuentes
```
/sdd-ff Mensajes "estoy vivo" y agregador de fuentes

Sigue specs-modulos.md §6 y §7, guardrails.md §4. Implementa alive_messages (texto/voz, asíncrono, entrega al buscar) y el agregador que importa por API/OCR respetando términos de cada fuente, marcando fuente + verificacion=verificada y citando origen. pnpm verify.
```

## Prompt Fase 8 — Satélite (en solitario, prototipo primero)
```
/sdd-new Módulo satelital (prototipo mínimo)

Sigue specs-modulos.md §8 y guardrails.md §5. Empieza por un prototipo mínimo: ingesta de tiles de muestra → barrido IA → sat_detections. Después, panel de validación humana y consenso → sat_alerts con coordenadas, exportables a rescate. La IA solo marca; el humano valida. Trabájalo en solitario (no multi-agente). pnpm verify.
```

## Prompt Fase 9 — Notificaciones
```
/sdd-ff Notificaciones transversales

Sigue specs-modulos.md §9. Implementa notifications entregadas por channels (Telegram/WhatsApp), con priorización (menores/urgentes primero), respeto a opt_in y reintentos en fallo. Un match o sat_alert genera la notificación. pnpm verify.
```

---

## Cierre (verificación global)
```
/sdd-verify

Ejecuta docs/sdd/05-verify.md y docs/harness.md: pnpm verify + pnpm ai:eval. Repasa el checklist de guardrails (contacto nunca expuesto, gates de menores y fallecidos, borrado, sin PII real, secretos fuera del repo). Dime qué falla, por gravedad.
```

> Multi-agente: tras el núcleo (fases 1-3), puedes lanzar fases 5, 6 y 7 en **git worktrees** paralelos y fusionarlas tras revisión. El satélite (fase 8), en solitario.
