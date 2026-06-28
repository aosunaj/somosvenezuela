# Prompts de despliegue — SomosVenezuela (vía MCP)

Bloque dedicado a **provisionar y desplegar** con tus MCP (GitHub, Supabase, Vercel, Railway/Render). Pégalos en orden en tu agente (OpenCode/Claude Code) con los MCP activos. Comprueba primero con `/mcp` (o el panel de OpenCode) qué tienes conectado.

> **Seguridad (aplica a todos):** el agente NO imprime secretos (responde "configurada ✓"); te muestra el plan y **pide confirmación** antes de cada acción con efecto (crear, fijar env, desplegar, setWebhook); la `service_role` y los tokens de bots **nunca** van al front (Vercel) ni al repo.

---

## 0. Repositorio (si usas MCP de GitHub)
```
Con el MCP de GitHub: crea el repo privado "somos-venezuela", sube el contenido actual (incluye CLAUDE.md, docs/, specs/, starter/ ya colocado en la raíz) y configura .gitignore para que .env nunca se suba. Confírmame la URL del repo.
```

## 1. Supabase — proyecto + migración
```
Con el MCP de Supabase: crea (o selecciona) el proyecto "somos-venezuela". Aplica la migración migrations/0001_init.sql. Verifica que existen los enums y las 15 tablas, que pg_trgm está activa y que RLS está habilitada en contacts, channels, notifications y minors. Devuélveme un resumen de lo creado y confírmame (sin pegar valores en claro) que tienes disponibles: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y DATABASE_URL.
```

## 2. Vercel — web (apps/web)
```
Con el MCP de Vercel: crea el proyecto de la web a partir de apps/web y conéctalo al repo. Fija las variables de entorno en development, preview y production tomando los valores del proyecto Supabase ya creado:
- PUBLIC_BASE_URL (la URL que asigne Vercel)
- SUPABASE_URL
- SUPABASE_ANON_KEY
NO añadas SUPABASE_SERVICE_ROLE_KEY ni tokens de bots al front. Lanza un primer deploy de preview y dame la URL. Confírmame cada variable como "configurada ✓" sin imprimir su valor.
```

## 3. Backend — Railway/Render (apps/backend)
```
Con el MCP de Railway (o Render): crea el servicio "somos-venezuela-backend" desde apps/backend, conectado al repo. Fija TODAS sus variables de entorno:
- De Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
- IA: ANTHROPIC_API_KEY, ANTHROPIC_MODEL
- Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
- WhatsApp: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
- Cloudinary: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
- Satélite (si toca): COPERNICUS_API_KEY
- Operación: NODE_ENV=production, PORT, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW, LOG_LEVEL=info
Toma de mí los tokens externos UNA sola vez y propágalos tú; no los teclearé en el panel. Despliega y dame la URL pública del backend.
```

## 4. Webhooks — Telegram y WhatsApp (tras tener URL pública del backend)
```
Configura los webhooks usando la URL pública del backend:
- Telegram: llama a setWebhook apuntando a {BACKEND_URL}/webhooks/telegram con el secret TELEGRAM_WEBHOOK_SECRET. Verifica con getWebhookInfo que quedó OK.
- WhatsApp Cloud API: registra el webhook en {BACKEND_URL}/webhooks/whatsapp, usando WHATSAPP_VERIFY_TOKEN para la verificación y validando la firma con WHATSAPP_APP_SECRET. Suscribe los eventos de mensajes.
Confírmame que ambos webhooks responden correctamente.
```

## 5. Verificación post-despliegue
```
Comprueba el despliegue de punta a punta:
- Health del backend responde 200.
- La web carga y una búsqueda de prueba (datos sintéticos) funciona SIN exponer contacto.
- Un mensaje de prueba al bot de Telegram registra/busca correctamente.
- Repasa docs/guardrails.md: ninguna variable secreta quedó en el front ni en el repo; service_role solo en el backend.
Dame un checklist con el estado de cada punto.
```

## 6. Actualizaciones posteriores (cada cambio)
```
Para cada cambio: push al repo → Vercel y Railway redeployan solos. Si añades una variable nueva, fíjala por MCP en el entorno que corresponda (front: solo públicas; backend: el resto) y vuelve a desplegar. Recuérdame si alguna env nueva falta en alguna plataforma.
```

---

## Orden resumido
**(0) repo → (1) Supabase + migración → (2) Vercel web + env → (3) backend Railway/Render + env → (4) webhooks → (5) verificación.**

> Si te falta el MCP de Railway/Render, el agente fija lo que pueda (Supabase, Vercel) y te deja indicado el despliegue del backend. Alternativa de backend sin MCP: desplegar por CLI o conectar el repo desde el panel una sola vez; las env, igualmente, mejor por MCP cuando esté disponible.
