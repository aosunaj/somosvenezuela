# Automatización de plataformas (MCP) — SomosVenezuela

Objetivo: que **el propio agente** (OpenCode / Claude Code con tus MCP de **Vercel**, **Supabase**, etc.) provisione los recursos y **cargue las variables de entorno en las plataformas** sin que tú las metas a mano.

> Idea clave: muchas credenciales **no hace falta teclearlas**. El agente las **lee** de una plataforma por su MCP y las **escribe** en otra. Solo unas pocas (tokens de servicios externos sin MCP) se introducen una vez.

## Qué automatiza cada MCP
| MCP | El agente puede… | Variables que resuelve/coloca |
|---|---|---|
| **Supabase** | Crear/seleccionar proyecto, aplicar `migrations/0001_init.sql`, activar RLS, **leer** URL y claves del proyecto, crear buckets | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (las **lee** del proyecto) |
| **Vercel** | Crear el proyecto web, conectar el repo, **fijar env vars** (dev/preview/prod), desplegar | **Escribe** todas las que necesite la web/serverless |
| **GitHub** (si lo tienes) | Crear repo, push, abrir PRs, configurar secrets de Actions | Secrets de CI |
| **Railway/Render** (si hay MCP) | Crear servicio backend, fijar env vars, desplegar | Env del backend |
| **Cloudinary / otros** | Según el MCP disponible | Sus claves |

## Flujo recomendado (totalmente o casi sin manos)
1. **Supabase**: el agente crea el proyecto, aplica la migración y **obtiene** `SUPABASE_URL` + claves + `DATABASE_URL`.
2. **Vercel** (web) y **Railway/Render** (backend): el agente crea los proyectos y **fija las env vars** tomando los valores de Supabase del paso 1 + las de servicios externos (paso 3).
3. **Tokens externos sin MCP** (se aportan **una sola vez**): `TELEGRAM_BOT_TOKEN` (BotFather), `WHATSAPP_*` (Meta), `ANTHROPIC_API_KEY`, `CLOUDINARY_*`, `COPERNICUS_API_KEY`. Dáselos al agente para que él los **propague** a cada plataforma por MCP (no los pongas a mano en cada panel).
4. **Despliegue**: el agente despliega web (Vercel) y backend (Railway/Render) y configura los webhooks (Telegram/WhatsApp) apuntando a la URL pública.

## Mapa de dónde va cada variable
- **Web (Vercel)**: `PUBLIC_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (nunca la service_role en el front).
- **Backend (Railway/Render)**: todo lo demás, incluida `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, tokens de bots, `ANTHROPIC_API_KEY`, `CLOUDINARY_*`, `COPERNICUS_API_KEY`, `RATE_LIMIT_*`.
- **Nunca** la `SERVICE_ROLE_KEY` ni tokens de bots en el front ni en el repo.

## Prompts listos (pégalos en tu agente con los MCP activos)
**Provisionar Supabase + migración:**
```
Con el MCP de Supabase: crea (o selecciona) el proyecto "somos-venezuela", aplica la migración migrations/0001_init.sql, verifica que las tablas y enums existen y que RLS está activa en contacts, channels, notifications y minors. Luego dame (sin pegarlas en claro en el chat) los nombres de las variables que vas a usar y confírmame que las tienes: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL.
```
**Configurar Vercel (web) y fijar env vars automáticamente:**
```
Con el MCP de Vercel: crea el proyecto de la web (apps/web), conéctalo al repo, y fija las variables de entorno tomando SUPABASE_URL y SUPABASE_ANON_KEY del proyecto Supabase ya creado. NO pongas la service_role ni tokens de bots en el front. Configura entornos development, preview y production.
```
**Backend (Railway/Render) con todas las env:**
```
Crea el servicio backend (apps/backend) en Railway/Render y fija TODAS sus variables de entorno: las de Supabase (incluida service_role y DATABASE_URL), ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, WHATSAPP_*, CLOUDINARY_*, COPERNICUS_API_KEY y RATE_LIMIT_*. Toma de mí los tokens externos una sola vez y propágalos tú; no los teclearé en los paneles.
```
**Webhooks tras desplegar:**
```
Cuando el backend tenga URL pública, configura el webhook de Telegram (setWebhook con TELEGRAM_WEBHOOK_SECRET) y el de WhatsApp Cloud API (verify token y firma). Verifica que ambos responden.
```

## Reglas de seguridad al automatizar (importante)
- El agente puede **leer/escribir** secretos entre plataformas vía MCP, pero **no** los vuelca en el chat, en logs ni en el repo. Pídele que confirme "configurada ✓" sin imprimir el valor.
- Acciones con efecto (crear proyecto, fijar env, desplegar, setWebhook) son **irreversibles/sensibles**: que el agente te muestre el plan y te pida confirmación antes de ejecutar cada una.
- `.env` local solo para desarrollo; en producción las variables viven en las plataformas (no en archivos).
- Revisa que la `service_role` y los tokens de bots **nunca** acaben en el proyecto de Vercel del front.

> Nota: los MCP disponibles dependen de lo que tengas conectado en tu agente. Si falta alguno (p. ej. Railway), el agente fija lo que pueda por MCP y te deja indicado el resto. Comprueba tus MCP activos con `/mcp` (Claude Code) o el panel de OpenCode.
