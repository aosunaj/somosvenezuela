# SDD · 05 · Verify — Verificación

La verificación es doble: **técnica** (que funciona) y **de guardrails** (que es seguro y ético). Nada se da por hecho sin ambas.

## Técnica (automatizable — `pnpm verify`)
- [ ] `pnpm install` sin errores.
- [ ] `pnpm typecheck` sin errores (TS estricto, sin `any`).
- [ ] `pnpm lint` limpio.
- [ ] `pnpm test` verde (unit + integración). Cobertura ≥ objetivo de `docs/tdd-strategy.md`.
- [ ] Migraciones aplican y revierten en una BD limpia.
- [ ] Arranque de cada app sin errores (`backend`, `web`, bots en modo mock).

## Guardrails (checklist de seguridad/ética — obligatorio en cada módulo)
- [ ] Ningún endpoint/canal expone datos de contacto (teléfono) — test que lo verifica.
- [ ] Registros nuevos nacen `verificacion=sin_verificar`.
- [ ] `estado=fallecida` y confirmación de entrega de **menor** requieren fuente verificada + paso humano (test del gate).
- [ ] Existe y funciona el **borrado** por petición del usuario.
- [ ] No hay PII real en seeds, fixtures, logs ni prompts (escáner del harness).
- [ ] Secretos fuera del repo; `.env` ignorado.
- [ ] Toda fuente externa integrada cita origen y respeta términos.

## Específica de IA (eval harness)
- [ ] Set sintético "dorado" de matching: precisión/recall por encima del umbral acordado.
- [ ] El matching nunca auto-confirma casos sensibles; siempre score + revisión.
- [ ] Degradación: con la IA desactivada, registro y búsqueda manual siguen funcionando (test).

## Método
1. `pnpm verify` (ver `docs/harness.md`) en local y en CI.
2. Revisión humana contra `docs/guardrails.md` en módulos sensibles (menores, fallecidos, satélite).
3. `/sdd-verify` documenta esta checklist completándose por módulo.
4. Marca la tarea en `04-tasks.md` solo cuando técnica + guardrails estén en verde.
