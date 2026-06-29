-- SomosVenezuela · Migración 0005_person_state_audit
-- Auditoría de cambios de estado sensibles de personas (guardrail #8: «los cambios
-- en estados sensibles quedan auditados — quién, cuándo»).
--
-- Registra cada transición de `estado` de una persona junto al contacto que la
-- provocó y el instante exacto. Empieza cubriendo el RESCATADO por canal (paso a
-- `encontrada_viva`); retrofitear el borrado seguro y futuras transiciones
-- sensibles (fallecida, reunida, entrega de menor) a esta tabla es follow-up.
--
-- INTERNA / SENSIBLE: `changed_by_contact_id` referencia `contacts` (PII). Por eso
-- la tabla nace con RLS deny-all y sin grants a las claves públicas, igual que el
-- resto de tablas internas (ver 0002_rls_policies). Solo el backend (service_role,
-- BYPASSRLS) la lee y escribe.

-- ── Tabla de auditoría ──────────────────────────────────────
create table if not exists public.person_state_changes (
  id                    uuid primary key default gen_random_uuid(),
  -- La persona auditada. Si se borra (derecho al olvido), su rastro de auditoría
  -- se borra con ella (cascade): no conservamos historial de una persona eliminada.
  person_id             uuid not null references public.persons(id) on delete cascade,
  -- Estado previo (puede ser desconocido en algunos flujos: nulo permitido).
  estado_anterior       estado_persona,
  -- Estado resultante de la transición (siempre presente).
  estado_nuevo          estado_persona not null,
  -- QUIÉN: contacto que provocó el cambio (el dueño del canal en el rescatado).
  -- on delete set null: si el contacto se borra, conservamos el evento sin el autor.
  changed_by_contact_id uuid references public.contacts(id) on delete set null,
  -- CUÁNDO: instante del cambio.
  changed_at            timestamptz not null default now()
);

-- Índice por persona: la consulta natural es «historial de cambios de esta persona».
create index if not exists person_state_changes_person_idx
  on public.person_state_changes (person_id);

comment on table public.person_state_changes is
  'Auditoría de cambios de estado sensibles de personas (guardrail #8): quién (changed_by_contact_id) y cuándo (changed_at) provocó cada transición de estado. INTERNA/SENSIBLE: solo backend (service_role).';

-- ── RLS deny-all + mínimo privilegio (igual que tablas internas) ───
alter table public.person_state_changes enable row level security;
revoke all on public.person_state_changes from anon, authenticated;
