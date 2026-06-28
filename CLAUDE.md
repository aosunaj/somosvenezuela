# CLAUDE.md — SomosVenezuela

> Memoria del proyecto. Va en la raíz del repo; Claude Code la lee al arrancar. Léela entera antes de tocar nada.

## 1. Qué es y por qué importa
**SomosVenezuela** es una plataforma ciudadana de respuesta a la emergencia del terremoto de Venezuela 2026: una red de solidaridad para **buscar a los que faltan y reunir a las familias**. Su núcleo es el registro y la búsqueda de personas y mascotas desaparecidas por WhatsApp, Telegram y web, con matching por IA, mapa de zonas/necesidades, mensajes "estoy vivo" y un módulo satelital de búsqueda. **Es software de alto impacto humano: cada decisión técnica puede afectar a la seguridad de personas vulnerables.** Prioriza siempre: vidas > velocidad > funcionalidades.

**Identidad.** El nombre dice la misión: *SomosVenezuela* — un país que se busca y se cuida. Tono cercano, claro y digno; nada de tecnicismos de cara a la gente. Lema interno: "Nadie se queda atrás."

Stack 100% gratuito. Se construye con **Claude Code** y **Spec-Driven Development (SDD)**, por fases, priorizando lo que más vidas ayuda a reunir.

## 2. Principios rectores (no negociables)
1. **Privacidad y protección primero.** Datos de contacto (teléfono) NUNCA públicos; solo para notificar internamente. Mínimo de datos.
2. **Protección reforzada de menores.** Antitrata: solo entidades verificadas confirman la entrega de un menor. Máxima prioridad y verificación.
3. **Fallecimientos solo con fuente fiable confirmada.** Nunca por rumor. Estado por defecto: `sin_verificar`.
4. **La IA sugiere, los humanos confirman.** El matching y las detecciones satelitales son propuestas con score; las confirmaciones sensibles las valida una persona.
5. **Derecho al borrado.** Cualquiera puede eliminar su registro con un mensaje al bot.
6. **Respeto a las fuentes.** Cumplir los términos de cada fuente externa y citar siempre el origen.
7. **Código abierto y auditable.** Ver `docs/guardrails.md` para el detalle de todas estas reglas.

## 3. Stack (todo gratuito)
- **Backend/API**: Node.js + TypeScript + **Fastify**.
- **BD**: **Supabase** (PostgreSQL). Migraciones versionadas.
- **Bot Telegram**: Telegram Bot API (primero, sin aprobación).
- **Bot WhatsApp**: WhatsApp Cloud API (Meta) — alta lenta, pedir cuanto antes.
- **Web**: React + Vite + Tailwind. Hosting Vercel/Netlify.
- **Hosting backend**: Railway/Render.
- **Mapa**: Leaflet + OpenStreetMap (sin API key).
- **IA**: Claude API (matching, NLP, OCR con Claude Vision).
- **Satélite**: Copernicus/Sentinel/Maxar + visión por computador + Claude Vision.
- **Fotos**: Cloudinary. **Notificaciones**: vía los propios bots.

## 4. Estructura del repo (monorepo, pnpm workspaces)
```
somos-venezuela/
  apps/
    backend/        # API Fastify + lógica de dominio
    web/            # React + Vite + Tailwind
    bot-telegram/   # adaptador Telegram → backend
    bot-whatsapp/   # adaptador WhatsApp Cloud API → backend
  packages/
    core/           # dominio compartido: tipos, validación (zod), reglas
    db/             # cliente Supabase, esquema, migraciones, seeds
    ai/             # matching, NLP, OCR (envoltura de Claude API)
  docs/             # esta documentación (sdd/, guardrails, harness, etc.)
  specs/            # specs SDD por módulo (generados/curados)
  CLAUDE.md  AGENTS.md
```
> Decisión: monorepo para que bots y web compartan **un solo backend y modelo de datos** (requisito del plan). Gestor: **pnpm**.

## 5. Comandos
- Instalar: `pnpm install`
- Dev backend: `pnpm --filter backend dev`
- Dev web: `pnpm --filter web dev`
- Tests: `pnpm test` (todo) · `pnpm --filter <app> test`
- Typecheck: `pnpm typecheck` · Lint: `pnpm lint`
- Migraciones: `pnpm --filter db migrate` · Seeds (datos SINTÉTICOS): `pnpm --filter db seed`
- Verificación completa (harness): `pnpm verify` (ver `docs/harness.md`)

## 6. Convenciones
- TypeScript estricto, **sin `any`**. Validación de toda entrada externa con **zod**.
- Dominio en `packages/core`; los adaptadores (bots/web) no contienen reglas de negocio.
- Nombres en inglés en el código; textos de cara al usuario en **español**.
- Commits convencionales (`feat:`, `fix:`...). Una feature = una rama.
- Cada módulo entra con sus **tests** y respetando los **guardrails**.
- Nada de PII real en código, tests, seeds, logs ni prompts. Datos de prueba siempre sintéticos.

## 7. No tocar / cuidado
- Secretos (`.env`, tokens de bots, claves Supabase/Claude/Cloudinary): nunca en el repo; van en variables de entorno. `.env` en `.gitignore`.
- No exponer teléfonos ni datos de contacto en respuestas, web pública ni logs.
- No marcar `fallecida` ni confirmar entrega de menores sin fuente verificada (gate de guardrails).
- No integrar una fuente externa sin respetar sus términos.

## 8. Modo de trabajo (SDD con Claude Code)
1. Lee `docs/sdd/` y el spec del módulo en `specs/`.
2. Construye por fases (ver `docs/sdd/03-plan.md`): núcleo + Telegram primero.
3. Por módulo: `/sdd-new` (o `/sdd-ff` para tareas pequeñas) → revisar plan → `/sdd-apply` → `/sdd-verify`.
4. Multi-agente con **git worktrees** para módulos paralelos (web, mapa, mascotas, agregador); el satelital, en solitario y con prototipo mínimo primero.
5. Antes de dar por buena cualquier tarea: pasa el **harness** (`pnpm verify`) y revisa contra `docs/guardrails.md`.

## 9. Provisión de plataformas vía MCP (sin trabajo manual)
Hay MCP conectados (**Supabase**, **Vercel**, etc.). Úsalos para **provisionar y configurar** automáticamente: crear el proyecto Supabase y aplicar migraciones, crear los proyectos en Vercel/Railway, y **fijar las variables de entorno** en cada plataforma (leyendo de Supabase lo que haga falta). Detalle, mapa de variables y prompts en `docs/automatizacion-plataformas.md`.
- No vuelques secretos en el chat, logs ni repo: confirma "configurada ✓" sin imprimir valores.
- Acciones con efecto (crear proyecto, fijar env, desple