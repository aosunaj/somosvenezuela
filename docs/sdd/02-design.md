# SDD · 02 · Design — Arquitectura

## Visión general
Varios **frentes** (bots Telegram/WhatsApp, web) sobre **un backend y una base de datos comunes**. Todo gira en torno a un **registro central** de personas y mascotas con búsqueda y matching por IA.

```
 Telegram   WhatsApp     Web          Panel satélite
   bot        bot      (React)        (voluntarios)
    \          \         |               /
     \          \        |              /
      +----------+---- API REST -------+
                        |
        BACKEND (Node.js + TypeScript + Fastify)
                        |
   +--------+-----------+-----------+-----------+
 REGISTRO  MOTOR IA   MAPA/ZONAS  AGREGADOR   SATÉLITE
 personas  (match,                 fuentes    (IA +
 mascotas  OCR, NLP)               oficiales  humano)
                        |
        BASE DE DATOS (PostgreSQL / Supabase)
```

## Principios de arquitectura
- **Dominio en el centro** (`packages/core`): tipos, validación (zod), reglas (estados, verificación, prioridad). Los adaptadores (bots, web, agregador) **no** contienen reglas de negocio; solo traducen entrada/salida.
- **Canales como adaptadores finos**: Telegram y WhatsApp comparten la misma máquina de conversación; cambian solo el transporte y el formato de mensajes.
- **IA aislada** (`packages/ai`): el matching/OCR/NLP se invocan tras una interfaz; si la IA cae, el registro/búsqueda manual sigue. La IA devuelve **sugerencias con score**, nunca verdades.
- **Persistencia** (`packages/db`): cliente Supabase, esquema, migraciones y seeds sintéticos. Acceso a datos centralizado (repositorios), no SQL disperso por los adaptadores.
- **Capas de verificación** entre el dato y su publicación: `fuente` + `verificacion` + (para casos sensibles) confirmación humana.

## Componentes
| Componente | Paquete/App | Responsabilidad |
|---|---|---|
| API REST | `apps/backend` | Endpoints, auth de servicio, orquestación, rate limiting |
| Dominio | `packages/core` | Tipos, zod, reglas de estado/prioridad/verificación |
| Datos | `packages/db` | Supabase, esquema, migraciones, repositorios, seeds |
| IA | `packages/ai` | Matching, OCR (Claude Vision), NLP, priorización |
| Bot Telegram | `apps/bot-telegram` | Flujo de menús → backend |
| Bot WhatsApp | `apps/bot-whatsapp` | Igual flujo, Cloud API |
| Web | `apps/web` | Búsqueda pública, mapa, panel de voluntarios/satélite |

## Flujos clave
- **Registro**: canal → validación zod → `persons`/`pets` con `fuente=propia`, `verificacion=sin_verificar` → dispara matching contra `searches`.
- **Búsqueda**: consulta → matching (exacto + difuso/IA) → resultados ordenados por score con fuente/verificación → si hay coincidencia fuerte, crea `matches` y `notifications`.
- **Mensaje "estoy vivo"**: se guarda en `alive_messages` (texto/voz) y se entrega cuando la familia busca (asíncrono).
- **Satélite**: ingesta de tiles → barrido IA (`sat_detections`) → validación humana en panel → consenso → `sat_alerts` con coordenadas → export a rescate.
- **Notificación**: cualquier `match`/alerta relevante → `notifications` → entrega por el `channel` del usuario (Telegram/WhatsApp).

## Decisiones de diseño
- **Monorepo pnpm** para compartir dominio y datos entre canales (requisito del plan).
- **Fastify** por rendimiento y simplicidad; validación con zod + `fastify-type-provider-zod`.
- **Supabase** como Postgres gestionado gratuito; RLS activada para datos sensibles.
- **Matching híbrido**: primero normalización + similitud (trigram/levenshtein en Postgres `pg_trgm`), y solo los casos dudosos pasan por Claude (ahorra coste y es más rápido).
- **Multi-agente con git worktrees** para módulos paralelos; satélite en solitario.

## Modelo de datos
Resumen aquí; detalle completo con campos y clasificación de privacidad en `docs/data-model.md`. Tablas: `persons`, `pets`, `searches`, `matches`, `minors`, `alive_messages`, `zones`, `needs`, `sat_tiles`, `sat_detections`, `sat_alerts`, `sources`, `contacts`, `channels`, `notifications`.

Enums clave: `estado` (desaparecida, encontrada_viva, encontrada_herida, fallecida, reunida) · `fuente` (propia, cruz_roja, ocha, hospital, refugio, plataforma_aliada) · `verificacion` (verificada, sin_verificar).
