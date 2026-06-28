# Orden de uso — SomosVenezuela (paso a paso para Claude Code)

Tres fases: **A) preparar la carpeta y las cuentas**, **B) onboarding + cimientos**, **C) construir por fases**.

## Fase A · Preparar (una vez)
1. Crea el repo en WSL: `mkdir -p /home/anabel/proyectos/somos-venezuela` y entra (`cd`).
2. Copia dentro: `CLAUDE.md`, `AGENTS.md` (raíz) y la carpeta `docs/` (con `sdd/`, `guardrails.md`, `harness.md`, `tdd-strategy.md`, `data-model.md`, `specs-modulos.md`, `prompts-por-tarea.md`). Crea también `specs/` (vacía; ahí irán las specs por módulo).
3. Cuentas y credenciales. **Lo que tenga MCP (Supabase, Vercel…) lo provisiona y configura el propio agente** — ver `docs/automatizacion-plataformas.md`. Tú solo das una vez los **tokens de servicios sin MCP** y el agente los propaga:
   - **Supabase**: lo crea y configura el agente por MCP (proyecto, migración, claves, env).
   - **Vercel / Railway-Render**: el agente crea proyectos y **fija las env vars** por MCP.
   - **Telegram**: crea el bot con **BotFather** y dale el token al agente (una vez).
   - **WhatsApp Cloud API** (Meta): solicita acceso **ya** (tarda); luego pasa los tokens al agente.
   - **Claude API** y **Copernicus EMS**: solicita acceso; entrega las claves al agente para que las propague.
4. Abre Claude Code en la carpeta (`claude` o el panel de VS Code en WSL).

## Fase B · Onboarding + cimientos
5. Pega el **Prompt 0** (`/sdd-onboard`) → espera a que confirme que cargó la spec.
6. Pega el **Prompt Fase 0** (`/sdd-new` scaffold) → revisa el plan → `/sdd-apply` → `/sdd-verify`.
7. Comprueba: `pnpm install` y `pnpm verify` en verde. (Engram MCP debe verse con `/mcp` si lo quieres activo.)

## Fase C · Construir por fases (en orden)
8. **Fase 1** (registro/búsqueda) y **Fase 2** (Telegram): el núcleo. Con esto ya tienes algo desplegable y útil.
9. **Fase 3** (IA: matching + OCR).
10. **Fase 4** (WhatsApp).
11. **Fases 5-7** (web+mapa, menores+mascotas, "estoy vivo"+agregador): se pueden hacer en **git worktrees paralelos** y fusionar tras revisión.
12. **Fase 8** (satélite): en solitario, prototipo mínimo primero.
13. **Fase 9** (notificaciones): cierra el ciclo.
14. **Cierre**: prompt de verificación global (`/sdd-verify` + `pnpm verify` + `pnpm ai:eval`).

Cada fase tiene su prompt en `docs/prompts-por-tarea.md`. Antes de cerrar cualquier tarea: `pnpm verify` y repaso de `docs/guardrails.md`.

## Resumen en una línea
**Carpeta + cuentas → `/sdd-onboard` → scaffold (`/sdd-new`+apply+verify) → fases 1→9 con sus prompts → verificación global.**

## Regla de oro durante todo el proyecto
Vidas > velocidad > funcionalidades. Si algo choca con `guardrails.md` (contacto expuesto, menor sin verificar, fallecido por rumor, PII real, secreto en el repo), **no entra**.

## No olvides
- Difusión (parte del proyecto): Cruz Roja Venezuela, plataformas existentes, medios y diáspora. Mensaje simple: "Busca o avisa de que estás vivo por WhatsApp o Telegram."
- Asesoría de protección de datos y de menores con las entidades aliadas antes de manejar datos reales.
