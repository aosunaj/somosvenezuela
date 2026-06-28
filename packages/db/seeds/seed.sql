-- SomosVenezuela · Seeds SINTETICOS (packages/db/seeds/seed.sql)
-- =============================================================================
-- TODO ES FICTICIO. NO HAY PII REAL (guardrail #1 / docs/guardrails.md).
-- Nombres inventados tipo "Persona de Prueba N". Telefonos/emails de ejemplo no
-- enrutables. Ids UUID fijos para que el seed sea IDEMPOTENTE (ON CONFLICT DO
-- NOTHING). Sirve para verificar el comportamiento de las vistas *_public:
--   - Las personas ADULTAS aparecen en persons_public.
--   - El MENOR (edad<18 y/o fila en minors) NO aparece en persons_public.
--   - El contact_id NUNCA aparece en persons_public.
--   - El registro 'fallecida' cumple la constraint (verificacion='verificada').
-- =============================================================================

-- ── Contactos SINTETICOS (SENSIBLE: nunca publicos) ─────────────────
insert into contacts (id, telefono, email, solo_uso_interno) values
  ('c0000000-0000-4000-8000-000000000001', '+58-000-0000001', 'prueba1@example.invalid', true),
  ('c0000000-0000-4000-8000-000000000002', '+58-000-0000002', 'prueba2@example.invalid', true),
  ('c0000000-0000-4000-8000-000000000003', '+58-000-0000003', null, true)
on conflict (id) do nothing;

-- ── Canales SINTETICOS (SENSIBLE) ───────────────────────────────────
insert into channels (id, contact_id, plataforma, chat_id, opt_in) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'telegram', 'tg-test-1', true),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'whatsapp', 'wa-test-2', true)
on conflict (id) do nothing;

-- ── Fuentes SINTETICAS ──────────────────────────────────────────────
insert into sources (id, nombre, tipo, terminos_url, permiso_uso, atribucion_requerida) values
  ('50000000-0000-4000-8000-000000000001', 'Fuente de Prueba Propia', 'api', null, true, false),
  ('50000000-0000-4000-8000-000000000002', 'Entidad Verificadora de Prueba', 'pdf', 'https://example.invalid/terminos', true, true)
on conflict (id) do nothing;

-- ── Personas SINTETICAS ─────────────────────────────────────────────
-- Adultas (DEBEN aparecer en persons_public):
insert into persons (id, nombre, apellidos, edad, zona, descripcion, estado, fuente, verificacion, contact_id) values
  ('a0000000-0000-4000-8000-000000000001', 'Persona de Prueba 1', 'Apellido Ficticio', 34, 'Zona Sintetica Norte',
   'Datos de prueba: ropa azul, sin senas reales', 'desaparecida', 'propia', 'sin_verificar',
   'c0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', 'Persona de Prueba 2', 'Apellido Ficticio', 28, 'Zona Sintetica Sur',
   'Datos de prueba: chaqueta verde', 'encontrada_viva', 'cruz_roja', 'verificada',
   'c0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003', 'Persona de Prueba 3', 'Apellido Ficticio', 45, 'Zona Sintetica Norte',
   'Datos de prueba: gorra roja', 'desaparecida', 'propia', 'sin_verificar', null),
  -- Fallecida CON verificacion='verificada' (cumple la constraint fallecida_requiere_verificacion):
  ('a0000000-0000-4000-8000-000000000004', 'Persona de Prueba 4', 'Apellido Ficticio', 60, 'Zona Sintetica Este',
   'Datos de prueba: registro de fallecimiento verificado por fuente fiable', 'fallecida', 'hospital', 'verificada',
   'c0000000-0000-4000-8000-000000000003'),
  -- MENOR por EDAD (<18): NO debe aparecer en persons_public:
  ('a0000000-0000-4000-8000-000000000005', 'Menor de Prueba A', 'Apellido Ficticio', 9, 'Zona Sintetica Sur',
   'Datos de prueba de menor: excluido del feed publico', 'desaparecida', 'propia', 'sin_verificar', null),
  -- MENOR por REFUERZO en `minors` (sin edad): tampoco debe aparecer en persons_public:
  ('a0000000-0000-4000-8000-000000000006', 'Menor de Prueba B', 'Apellido Ficticio', null, 'Zona Sintetica Norte',
   'Datos de prueba de menor con refuerzo; sin edad pero marcado en minors', 'desaparecida', 'propia', 'sin_verificar', null)
on conflict (id) do nothing;

-- ── Refuerzo de menor (1-1 con persons) ─────────────────────────────
-- Marca explicita de menor para la persona 6 (que no tiene edad). La vista
-- persons_public excluye toda fila con entrada en `minors`.
insert into minors (id, person_id, tutor_conocido, entidad_verificadora, entrega_confirmada, confirmada_por, notas) values
  ('60000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'Tutor de Prueba',
   '50000000-0000-4000-8000-000000000002', false, null, 'Nota sintetica sensible de prueba')
on conflict (id) do nothing;

-- ── Mascotas SINTETICAS ─────────────────────────────────────────────
insert into pets (id, nombre, tipo, raza, zona, estado, fuente, verificacion, contact_id) values
  ('b0000000-0000-4000-8000-000000000001', 'Mascota de Prueba 1', 'perro', 'mestizo', 'Zona Sintetica Norte',
   'desaparecida', 'propia', 'sin_verificar', 'c0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'Mascota de Prueba 2', 'gato', 'comun', 'Zona Sintetica Sur',
   'encontrada_viva', 'refugio', 'verificada', null)
on conflict (id) do nothing;

-- ── Zonas SINTETICAS ────────────────────────────────────────────────
insert into zones (id, nombre, lat, lng, estado, actualizado_por) values
  ('70000000-0000-4000-8000-000000000001', 'Zona Sintetica Norte', 10.500, -66.900, 'afectada', 'voluntario-prueba'),
  ('70000000-0000-4000-8000-000000000002', 'Zona Sintetica Sur', 10.400, -66.950, 'estable', 'voluntario-prueba')
on conflict (id) do nothing;

-- ── Necesidades SINTETICAS por zona ─────────────────────────────────
insert into needs (id, zone_id, tipo, urgencia, descripcion) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'agua', 'critica', 'Necesidad de prueba'),
  ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'medicinas', 'alta', 'Necesidad de prueba'),
  ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000002', 'rescatistas', 'media', 'Necesidad de prueba')
on conflict (id) do nothing;
