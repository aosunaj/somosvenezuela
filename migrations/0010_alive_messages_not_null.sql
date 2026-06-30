-- SomosVenezuela · Migración 0010_alive_messages_not_null
-- Spec 06 Slice 1 hardening: enforce NOT NULL on autor_nombre and contenido.
--
-- RATIONALE: The alive_messages table was created with these columns nullable
-- (no explicit NOT NULL). The application layer (Zod schema) already enforces
-- min(1) on both, so the table is empty in practice and the constraint is safe
-- to add. This migration closes the gap between the application guardrail and
-- the database constraint, ensuring integrity even if rows are inserted outside
-- the API (e.g., migrations, seeds, direct SQL).
--
-- IDEMPOTENCY: PostgreSQL silently skips setting NOT NULL when the column is
-- already NOT NULL. Safe to re-run.

ALTER TABLE alive_messages ALTER COLUMN autor_nombre SET NOT NULL;
ALTER TABLE alive_messages ALTER COLUMN contenido SET NOT NULL;
