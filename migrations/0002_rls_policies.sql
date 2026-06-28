-- SomosVenezuela · Migración 0002_rls_policies
-- Cierra el riesgo crítico que dejó 0001: 11 tablas públicas con RLS deshabilitado.
-- Estrategia: RLS deny-all en TODAS las tablas base + vistas que exponen SOLO
-- columnas no sensibles a la anon key. Escritura: exclusiva del backend (service_role).
-- Guardrail #1 (privacidad primero): contact_id y toda PII nunca llegan a clientes públicos.

-- ── Modelo de acceso ────────────────────────────────────────
-- Roles de Supabase:
--   • service_role        → BYPASSRLS. Lo usa SOLO el backend Fastify. Acceso total.
--   • anon / authenticated → claves públicas (web). Solo leen las vistas *_public.
-- Regla: ninguna clave pública toca una tabla base. Lectura pública = vistas curadas.

-- ── 1. Habilitar RLS en las 11 tablas que quedaron expuestas ─
alter table public.persons        enable row level security;
alter table public.pets           enable row level security;
alter table public.sources        enable row level security;
alter table public.searches       enable row level security;
alter table public.matches        enable row level security;
alter table public.alive_messages enable row level security;
alter table public.zones          enable row level security;
alter table public.needs          enable row level security;
alter table public.sat_tiles      enable row level security;
alter table public.sat_detections enable row level security;
alter table public.sat_alerts     enable row level security;

-- ── 2. Mínimo privilegio: revocar TODO acceso de las claves públicas
--     a las tablas base (defensa en profundidad sobre el deny-all de RLS).
--     service_role no se ve afectado: tiene sus propios grants y BYPASSRLS.
revoke all on public.persons,        public.pets,           public.sources,
              public.searches,       public.matches,        public.alive_messages,
              public.zones,          public.needs,
              public.sat_tiles,      public.sat_detections, public.sat_alerts,
              public.contacts,       public.channels,       public.minors,
              public.notifications
  from anon, authenticated;

-- ── 3. Vistas públicas: SOLO columnas no sensibles ──────────
-- security_invoker = false (definer): la vista corre con permisos del owner y
-- expone únicamente las columnas listadas; la anon key nunca alcanza la tabla base
-- ni sus columnas internas/sensibles. Es intencional y acotado a SELECT de columnas.
--
-- AUDITORÍA — lint `security_definer_view` (Supabase, nivel ERROR) ASUMIDO A PROPÓSITO:
-- el modo definer es necesario para (a) ocultar columnas sensibles como contact_id y
-- (b) filtrar menores leyendo `minors` (que tiene RLS). El modo invoker que pide el
-- linter ROMPERÍA el filtro de menores: la anon key no ve `minors`, así que un menor
-- con refuerzo NO quedaría excluido — un fallo peor que el lint. Las vistas son SELECT
-- planos de columnas públicas; no hay escalada de privilegios. Trade-off documentado.

-- persons: todo es público SALVO contact_id (clasificado «interna», nunca público).
-- ANTITRATA (guardrail #2): los menores NO se exponen en el feed público anónimo.
-- Un menor es: edad < 18, O tiene refuerzo en `minors` (marca deliberada).
-- El familiar NO se entera por esta vista, sino por su canal privado (bot):
-- notificación dirigida tras matching + validación de entidad verificada, y
-- consulta al bot autenticada por su chat_id. Ver `notifications`/`channels`/`matches`.
create or replace view public.persons_public
  with (security_invoker = false) as
  select id, nombre, apellidos, edad, zona, descripcion, foto_url,
         estado, fuente, verificacion, created_at, updated_at
  from public.persons p
  where coalesce(p.edad, 999) >= 18
    and not exists (select 1 from public.minors m where m.person_id = p.id);

-- pets: todo público salvo contact_id
create or replace view public.pets_public
  with (security_invoker = false) as
  select id, nombre, tipo, raza, zona, foto_url,
         estado, fuente, verificacion, created_at, updated_at
  from public.pets;

-- zones: oculta actualizado_por (identidad del voluntario)
create or replace view public.zones_public
  with (security_invoker = false) as
  select id, nombre, lat, lng, estado, updated_at
  from public.zones;

-- needs: sin columnas sensibles
create or replace view public.needs_public
  with (security_invoker = false) as
  select id, zone_id, tipo, urgencia, descripcion, updated_at
  from public.needs;

-- sources: transparencia de fuentes (sin datos sensibles)
create or replace view public.sources_public
  with (security_invoker = false) as
  select id, nombre, tipo, terminos_url, atribucion_requerida
  from public.sources;

-- ── 4. Conceder lectura pública SOLO sobre las vistas ───────
grant select on public.persons_public, public.pets_public,
                public.zones_public,   public.needs_public,
                public.sources_public
  to anon, authenticated;

-- Nota deliberada: searches, matches, alive_messages y sat_* NO tienen vista pública.
-- Son flujo interno: búsquedas (con buscador_contact_id sensible), revisión humana de
-- coincidencias, buzón "estoy vivo" (se entrega a la familia, no se publica en abierto)
-- y cadena satelital. Se sirven solo desde el backend con service_role.

-- ── 5. Endurecer la función de trigger (corrige WARN search_path mutable) ───
-- now() vive en pg_catalog, siempre implícito incluso con search_path vacío.
alter function public.set_updated_at() set search_path = '';

-- ── DECISIÓN TOMADA: menores fuera del feed público ─────────
-- Los menores quedan excluidos de persons_public (filtro arriba). Su búsqueda y
-- reunión se gestionan por canal privado: bot + matching interno + validación de
-- entidad verificada + notificación dirigida al familiar. Estado MVP y reversible:
-- cuando exista autenticación de entidades, se les podrá liberar la ficha completa
-- a roles verificados (nunca al público anónimo).
-- Borde conocido: un menor registrado SIN edad y SIN fila en `minors` se asumiría
-- adulto. Mitigación en Fase 1: el registro por bot debe capturar la condición de
-- menor (crear `minors` o fijar edad) cuando corresponda.
