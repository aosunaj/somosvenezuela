-- SomosVenezuela · Migración 0007_estado_a_salvo
-- Agrega el valor 'a_salvo' al enum estado_persona.
--
-- REGLA CRITICA (R2-2c): este archivo contiene SOLO el ALTER TYPE ADD VALUE.
-- No puede compartir transacción con otras sentencias en algunas versiones de
-- PostgreSQL. El runner de migraciones (migrate.ts) lo detecta por regex de
-- contenido y lo ejecuta fuera de una transacción explícita.
--
-- 'a_salvo' es el estado que una persona confirma cuando está segura y localizada
-- pero aún no fue reunida formalmente con su familia. Solo puede ser seteado por
-- confirmación humana explícita (assertEstadoASalvoValido) — NUNCA automáticamente.
-- Espejado en packages/core/src/enums.ts (estadoPersonaSchema).

alter type public.estado_persona add value if not exists 'a_salvo';
