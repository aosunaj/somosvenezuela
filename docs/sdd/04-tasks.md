# SDD · 04 · Tasks — Desglose por fases

Marca `[x]` al cerrar cada tarea (con tests + guardrails + `pnpm verify` en verde). Cada bloque corresponde a una fase de `03-plan.md`.

## Fase 0 · Preparación
- [ ] T0.1 Monorepo pnpm (apps/, packages/), tsconfig estricto, lint, vitest, `pnpm verify`.
- [x] T0.2 `packages/core`: tipos base + enums (`estado`, `fuente`, `verificacion`) + esquemas zod.
- [x] T0.3 `packages/db`: cliente Supabase, migración inicial, repositorios base, **seeds sintéticos**.
- [x] T0.4 CI mínima (typecheck + lint + test) y `docs/harness.md` operativo.

## Fase 1 · Registro y búsqueda de personas (núcleo)
- [x] T1.1 Migración tablas `persons`, `searches`, `contacts`, `sources`, `channels`.
- [x] T1.2 Endpoints: alta de persona, búsqueda (nombre/zona/descr.), alta de búsqueda.
- [x] T1.3 Reglas de dominio: estados, verificación por defecto `sin_verificar`, ocultar contacto.
- [x] T1.4 Búsqueda con `pg_trgm` (similitud) ordenada por score. Tests de dominio + integración.

## Fase 2 · Bot de Telegram
- [ ] T2.1 Máquina de conversación compartida (`packages/core`): registrar, buscar, mensaje, reportar, subir foto.
- [x] T2.2 Adaptador Telegram (Bot API) → backend. Menús guiados en español.
- [ ] T2.3 Comando de **borrado** del propio registro. Tests del flujo.

## Fase 3 · Motor IA: matching + OCR
- [ ] T3.1 `packages/ai`: interfaz de matching (normaliza nombres, apodos, variantes) con score.
- [ ] T3.2 Matching híbrido: pg_trgm primero, Claude solo en casos dudosos. Genera `matches`.
- [ ] T3.3 OCR de listas en papel (Claude Vision) → extracción de nombres → registros `sin_verificar`.
- [ ] T3.4 Priorización (menores, mayores, heridos). **Eval harness** con set sintético dorado.

## Fase 4 · Bot de WhatsApp
- [ ] T4.1 Adaptador WhatsApp Cloud API reutilizando la máquina de conversación.
- [ ] T4.2 Webhooks, verificación de firma, límites de la Cloud API. Tests del flujo.

## Fase 5 · Web + mapa
- [ ] T5.1 Web React: búsqueda pública (sin exponer contacto) con fuente/verificación.
- [ ] T5.2 Mapa Leaflet + zonas/necesidades (`zones`, `needs`) editable por voluntarios.

## Fase 6 · Menores + mascotas
- [ ] T6.1 `minors` enlazado a `persons`: verificación reforzada + gate de confirmación humana.
- [ ] T6.2 `pets`: alta/búsqueda/matching reutilizando el núcleo.

## Fase 7 · "Estoy vivo" + agregador
- [ ] T7.1 `alive_messages` (texto/voz) asíncronos + entrega al buscar.
- [ ] T7.2 Agregador: import por API/OCR respetando términos; marca fuente + `verificada`.

## Fase 8 · Satélite (IA + humano)
- [ ] T8.1 Prototipo mínimo: ingesta de tiles + barrido IA → `sat_detections`.
- [ ] T8.2 Panel de validación humana; consenso → `sat_alerts` con coordenadas; export a rescate.

## Fase 9 · Notificaciones
- [ ] T9.1 `notifications` + entrega por `channels`; priorización (menores/urgentes primero).

## Transversal (cada fase)
- [ ] Cumplir `docs/guardrails.md` (PII, menores, fallecidos, fuentes).
- [ ] Tests según `docs/tdd-strategy.md`. `pnpm verify` en verde.
