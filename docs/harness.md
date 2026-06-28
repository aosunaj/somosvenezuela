# Harness de verificación — SomosVenezuela

El "harness" es el conjunto de comprobaciones que Claude Code (y la CI) ejecutan para validar el trabajo de forma repetible. Un solo comando: **`pnpm verify`**.

## `pnpm verify` encadena
1. `pnpm typecheck` — TypeScript estricto en todo el monorepo.
2. `pnpm lint` — ESLint + reglas del proyecto.
3. `pnpm test` — Vitest (unit + integración) con BD de test y mocks de servicios externos.
4. `pnpm guardrails:scan` — comprobaciones automáticas de guardrails (ver abajo).
5. `pnpm db:check` — migraciones aplican y revierten en BD limpia.

Definir como script raíz en `package.json`:
```json
{ "scripts": {
  "verify": "pnpm typecheck && pnpm lint && pnpm test && pnpm guardrails:scan && pnpm db:check"
}}
```

## guardrails:scan (checks automáticos)
Script que falla el build si detecta:
- **PII real / secretos** en código, seeds, fixtures o `.env` commiteado (regex de teléfonos VE, tokens, claves). 
- Respuestas de API/bot que incluyan campos de `contacts` (test de contrato que afirma que el contacto nunca sale).
- Endpoints o queries que devuelvan `telefono`/`contact` en payloads públicos.
- Seeds con datos no marcados como sintéticos.

## Datos para el harness
- **Seeds sintéticos** (`packages/db/seeds`): personas, zonas, fuentes ficticias para dev y test.
- **Set "dorado" de IA** (`packages/ai/eval/golden`): pares búsqueda↔registro etiquetados (match / no-match) para medir el matching, y fotos sintéticas de listas para el OCR.

## Eval de IA (`pnpm ai:eval`)
- Ejecuta el matching sobre el set dorado y reporta **precisión y recall**; falla si baja del umbral acordado.
- Verifica que **no auto-confirma** casos sensibles (todos salen como `propuesto`).
- Verifica **degradación**: con el proveedor de IA desactivado, registro/búsqueda manual funcionan.

## CI (GitHub Actions, gratis)
- En cada push a `main` y en cada PR: `pnpm install --frozen-lockfile` + `pnpm verify:ci`
  (= build + typecheck + lint + test + guardrails:scan). Ver `.github/workflows/ci.yml`.
- `db:check` aún NO corre en CI: necesita un proyecto Supabase (URL + service_role); se
  valida en local/staging y se añadirá cuando haya credenciales de test en GitHub Secrets.
- `pnpm ai:eval` se sumará como job aparte (no bloqueante) cuando exista `packages/ai` (Fase 3).
- Sin secretos reales en CI: los servicios externos se mockean en los tests.

## Servicios externos en modo prueba
- Claude API → fake configurable (respuestas deterministas).
- Telegram/WhatsApp → transporte mock; webhooks simulados con firma de prueba.
- Cloudinary → almacenamiento en memoria/local en test.
- Satélite (Copernicus/Sentinel/Maxar) → tiles de muestra locales.

## Cómo lo usa Claude Code
- Antes de cerrar cualquier tarea: `pnpm verify`. Si algo falla, no se da por hecha.
- `/sdd-verify` ejecuta y documenta este harness por módulo.
- Para módulos sensibles, además, **revisión humana** contra `docs/guardrails.md`.
