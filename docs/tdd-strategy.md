# Estrategia TDD — SomosVenezuela

## Enfoque
TDD **pragmático con módulos críticos en estricto**. La urgencia no justifica romper lo que salva vidas: las reglas de dominio sensibles se escriben **test-first**. El resto sigue un ciclo rojo→verde→refactor razonable, sin dogmatismo.

## Niveles de prueba
1. **Unit (dominio, `packages/core`)** — la mayor parte. Reglas de estado, verificación, prioridad, validación zod. Rápidos, sin red ni BD.
2. **Integración (`packages/db`, `apps/backend`)** — endpoints + BD real de test (Supabase local o contenedor Postgres). Migraciones, repositorios, búsqueda con pg_trgm.
3. **Conversación (bots)** — la máquina de conversación se testea como unidad (entrada→estado→salida), con transporte mockeado.
4. **E2E ligero** — flujos críticos: registrar→buscar→match→notificar (backend + adaptador mock).
5. **Eval de IA** — set sintético "dorado" para matching/OCR (ver `harness.md`).

## Stack de test
- **Vitest** (unit + integración) en todo el monorepo.
- **Supertest**/inject de Fastify para endpoints.
- Postgres de test (Supabase CLI local o `pg` en contenedor) con migraciones aplicadas y **seeds sintéticos**.
- Sin servicios externos reales en tests: Claude, Telegram, WhatsApp, Cloudinary, satélite → **mocks/fakes**.

## Módulos en TDD estricto (test-first obligatorio)
- Ocultación de contacto (ningún output expone teléfono).
- Estados sensibles: gate de `fallecida` (requiere fuente verificada).
- Menores: gate de `entrega_confirmada` (solo entidad verificada).
- Borrado (derecho al olvido) completo y verificable.
- Matching: nunca auto-confirma casos sensibles.

## Datos de prueba
- **Solo sintéticos.** Nombres y teléfonos ficticios generados (p. ej. faker con locale es). **Nunca PII real**, ni siquiera anonimizada de personas reales.
- Fixtures compartidos en `packages/db/seeds` y `packages/core/test/fixtures`.

## Cobertura (objetivos orientativos)
- `packages/core` (dominio): **≥ 90 %**.
- `packages/db` + `apps/backend`: **≥ 75 %**.
- Adaptadores (bots/web): foco en flujos, no en porcentaje.

## Ciclo de trabajo con Claude Code
1. Escribe el test de la regla (rojo).
2. Implementa lo mínimo (verde).
3. Refactor con tests delante.
4. `pnpm verify` antes de cerrar la tarea.

> En Claude Code puedes pedirlo en lenguaje natural: "escribe primero el test de que el endpoint de búsqueda nunca devuelve el teléfono; luego impleméntalo". Las skills aplican el patrón de Vitest/Fastify actual.
