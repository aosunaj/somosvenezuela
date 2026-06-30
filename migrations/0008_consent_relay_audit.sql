-- SomosVenezuela · Migración 0008_consent_relay_audit
-- Núcleo del reencuentro automático (Capa 2): consentimiento bilateral,
-- relay de contacto temporal y auditoría inmutable con soporte de borrado.
--
-- PRIVACIDAD (guardrails #1 y #2):
--   - NINGUN número de teléfono ni PII en ninguna tabla nueva.
--   - Menores: el gate se aplica en el backend (routeMatch); esta migración
--     no abre la vía automática para menores.
--   - El contacto en claro solo viaja en la notificación punto a punto tras el
--     doble consentimiento; nunca se persiste en estas tablas.
--
-- ATOMICIDAD (R2-1): operaciones sensibles realizadas por las funciones plpgsql
-- `accept_consent_and_open_relay` y `close_relays_and_delete_contact` que se
-- ejecutan como transacciones únicas invocadas via supabase rpc().
--
-- INMUTABILIDAD DE AUDITORÍA (R2-3): el trigger `auto_connection_audit_guard`
-- permite SOLO el nulling de contact_ids (erasure), bloquea cualquier otro
-- UPDATE y todo DELETE.
--
-- Idempotente: usa IF NOT EXISTS / CREATE OR REPLACE / DO..exception cuando
-- aplica. Ejecuta sobre la BD ya migrada hasta 0007.

-- ── Columna es_menor en searches ──────────────────────────────────────────
-- Indica si la búsqueda es sobre un menor de edad. NUNCA valor por defecto
-- silencioso: el backend lo setea de forma conservadora server-side en cada
-- creación (POST /searches con isMinorByContactId — judgment-r3 item 5).
-- El DEFAULT false aplica SOLO a filas sin este dato; routeMatch lo trata
-- conservadoramente (conservative branch tiene mayor prioridad que es_menor=false).

alter table public.searches
  add column if not exists es_menor boolean not null default false;

comment on column public.searches.es_menor is
  'True si la búsqueda involucra un menor. Seteado server-side de forma conservadora; NUNCA por input del cliente sin validación.';

-- ── Columnas de verificación en persons y pets ────────────────────────────
-- Pregunta y hash de respuesta para la verificación de identidad en el flujo
-- de consentimiento. La respuesta RAW nunca se persiste: solo el hash argon2id.
-- Excluidas de las vistas *_public (guardrail #1).

alter table public.persons
  add column if not exists verification_question text,
  add column if not exists verification_answer_hash text;

alter table public.pets
  add column if not exists verification_question text,
  add column if not exists verification_answer_hash text;

comment on column public.persons.verification_question is
  'Pregunta de verificación de identidad para el flujo de consentimiento. Nunca expuesta en persons_public.';
comment on column public.persons.verification_answer_hash is
  'Hash argon2id de la respuesta (NUNCA la respuesta en claro). Excluida de vistas públicas.';
comment on column public.pets.verification_question is
  'Pregunta de verificación para mascotas. Nunca expuesta en pets_public.';
comment on column public.pets.verification_answer_hash is
  'Hash argon2id de la respuesta (NUNCA la respuesta en claro). Excluida de vistas públicas.';

-- ── notifications: channel_id ON DELETE SET NULL ──────────────────────────
-- Asegura que al borrar un contacto (cascade → channels) las notificaciones
-- del OTRO canal sobrevivan con channel_id = NULL (no se borran). Esto es
-- clave para R2-1b: close_relays_and_delete_contact inserta la notificación
-- al otro canal ANTES de borrar el contacto propio; la FK SET NULL permite
-- que esa fila no sea eliminada en cascade cuando el otro contacto se borre
-- en el futuro.
-- Esta constraint puede ya existir en 0001; el bloque DO captura el error si
-- se intenta añadir una constraint duplicada.

do $$ begin
  alter table public.notifications
    drop constraint if exists notifications_channel_id_fkey;
  alter table public.notifications
    add constraint notifications_channel_id_fkey
    foreign key (channel_id) references public.channels(id)
    on delete set null;
exception when duplicate_object then null;
end $$;

-- ── Tabla: consent_sessions ────────────────────────────────────────────────
-- Una sesión de consentimiento por par (match × búsqueda). Ciclo de vida:
--   pending (searcher_accepted=false, registrant_accepted=false)
--   → both_accepted (ambos = true) → relay abierto
--   → declined / expired / failed_verification (terminales)
--
-- judgment-r3 item 8: estado ÚNICO 'pending' + dos booleans (no pending_a/b).

create table if not exists public.consent_sessions (
  id                      uuid        primary key default gen_random_uuid(),
  match_id                uuid        not null
                            references public.matches(id) on delete cascade,
  searcher_contact_id     uuid
                            references public.contacts(id) on delete cascade,
  registrant_contact_id   uuid
                            references public.contacts(id) on delete cascade,
  searcher_channel_id     uuid
                            references public.channels(id) on delete cascade,
  registrant_channel_id   uuid
                            references public.channels(id) on delete cascade,
  searcher_accepted       boolean     not null default false,
  registrant_accepted     boolean     not null default false,
  state                   text        not null default 'pending',
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null
);

do $$ begin
  alter table public.consent_sessions
    add constraint consent_sessions_state_check
    check (state in (
      'pending',
      'both_accepted',
      'declined',
      'expired',
      'failed_verification'
    ));
exception when duplicate_object then null; end $$;

comment on table public.consent_sessions is
  'Sesión de consentimiento bilateral para el reencuentro. Estado: pending → both_accepted | declined | expired | failed_verification.';
comment on column public.consent_sessions.state is
  'Estado unificado: pending (único estado inicial) + booleans. judgment-r3 item 8: no pending_a/pending_b.';

-- ── Tabla: relay_sessions ─────────────────────────────────────────────────
-- Canal temporal bilateral de mensajes entre dos partes que consintieron.
-- Garantías:
--   - UNIQUE(consent_session_id): solo un relay por consentimiento.
--   - CHECK(party_a_channel_id <> party_b_channel_id): no auto-relay.
--   - FKs ON DELETE CASCADE: si el canal desaparece, el relay se cierra.

create table if not exists public.relay_sessions (
  id                      uuid        primary key default gen_random_uuid(),
  consent_session_id      uuid        not null unique
                            references public.consent_sessions(id) on delete cascade,
  party_a_channel_id      uuid        not null
                            references public.channels(id) on delete cascade,
  party_b_channel_id      uuid        not null
                            references public.channels(id) on delete cascade,
  state                   text        not null default 'active',
  reveal_requested_a      boolean     not null default false,
  reveal_requested_b      boolean     not null default false,
  created_at              timestamptz not null default now()
);

do $$ begin
  alter table public.relay_sessions
    add constraint relay_sessions_different_parties_check
    check (party_a_channel_id <> party_b_channel_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.relay_sessions
    add constraint relay_sessions_state_check
    check (state in ('active', 'closed', 'contact_revealed'));
exception when duplicate_object then null; end $$;

comment on table public.relay_sessions is
  'Canal temporal de mensajes entre dos partes con doble consentimiento. UNIQUE por consent_session garantiza exactamente un relay por consentimiento.';

-- ── Tabla: auto_connection_audit ──────────────────────────────────────────
-- Auditoría append-only de decisiones de routing y cambios de consentimiento.
-- INMUTABLE salvo el nulling de contact_ids en borrado (R2-3).
-- Protegida por trigger auto_connection_audit_guard (ver abajo).

create table if not exists public.auto_connection_audit (
  id                      uuid        primary key default gen_random_uuid(),
  event_type              text        not null,
  match_id                uuid,
  searcher_contact_id     uuid,
  registrant_contact_id   uuid,
  score                   numeric(4, 3),
  threshold               numeric(4, 3),
  result                  text,
  created_at              timestamptz not null default now()
);

do $$ begin
  alter table public.auto_connection_audit
    add constraint auto_connection_audit_event_type_check
    check (event_type in ('route_decision', 'consent_state_change', 'contact_reveal'));
exception when duplicate_object then null; end $$;

comment on table public.auto_connection_audit is
  'Auditoría inmutable de decisiones de reencuentro automático. SOLO el nulling de contact_ids está permitido (erasure). Ver trigger auto_connection_audit_guard.';
comment on column public.auto_connection_audit.searcher_contact_id is
  'Puede ser NULL tras borrado (erasure). El trigger permite este nulling pero bloquea cualquier otra modificación.';
comment on column public.auto_connection_audit.registrant_contact_id is
  'Puede ser NULL tras borrado (erasure). El trigger permite este nulling pero bloquea cualquier otra modificación.';

-- ── RLS: deny-all + service_role access ──────────────────────────────────
-- Las tres tablas nuevas siguen el patrón de 0002_rls_policies:
-- deny-all por defecto (RLS on); solo service_role (backend) tiene acceso.
-- La anon key y authenticated nunca ven estas tablas.

alter table public.consent_sessions  enable row level security;
alter table public.relay_sessions    enable row level security;
alter table public.auto_connection_audit enable row level security;

do $$ begin
  create policy "service_role_only" on public.consent_sessions
    for all to service_role using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "service_role_only" on public.relay_sessions
    for all to service_role using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "service_role_only" on public.auto_connection_audit
    for all to service_role using (true);
exception when duplicate_object then null; end $$;

-- ── Trigger: inmutabilidad parcial de auto_connection_audit (R2-3) ────────
-- Permite SOLO el nulling de searcher_contact_id y/o registrant_contact_id.
-- Bloquea cualquier otro UPDATE y todo DELETE.
-- service_role bypasa RLS pero NO los triggers: esta es la capa de enforcement.

create or replace function public.auto_connection_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'auto_connection_audit es append-only: DELETE no permitido (guardrail auditoría)';
  end if;

  -- UPDATE: solo se permite nulling de las dos columnas contact_id.
  -- Cualquier otra columna debe ser IDÉNTICA entre OLD y NEW.
  if (new.id               is distinct from old.id)               then
    raise exception 'auto_connection_audit: no se puede modificar id';
  end if;
  if (new.event_type       is distinct from old.event_type)       then
    raise exception 'auto_connection_audit: no se puede modificar event_type';
  end if;
  if (new.match_id         is distinct from old.match_id)         then
    raise exception 'auto_connection_audit: no se puede modificar match_id';
  end if;
  if (new.score            is distinct from old.score)            then
    raise exception 'auto_connection_audit: no se puede modificar score';
  end if;
  if (new.threshold        is distinct from old.threshold)        then
    raise exception 'auto_connection_audit: no se puede modificar threshold';
  end if;
  if (new.result           is distinct from old.result)           then
    raise exception 'auto_connection_audit: no se puede modificar result';
  end if;
  if (new.created_at       is distinct from old.created_at)       then
    raise exception 'auto_connection_audit: no se puede modificar created_at';
  end if;

  -- contact_id columns: only NULL is permitted as new value (erasure).
  if (new.searcher_contact_id is distinct from old.searcher_contact_id) then
    if new.searcher_contact_id is not null then
      raise exception 'auto_connection_audit: searcher_contact_id solo puede ponerse a NULL (erasure), no cambiarse a otro valor';
    end if;
  end if;
  if (new.registrant_contact_id is distinct from old.registrant_contact_id) then
    if new.registrant_contact_id is not null then
      raise exception 'auto_connection_audit: registrant_contact_id solo puede ponerse a NULL (erasure), no cambiarse a otro valor';
    end if;
  end if;

  return new;
end;
$$;

do $$ begin
  create trigger auto_connection_audit_guard_trigger
    before update or delete on public.auto_connection_audit
    for each row execute function public.auto_connection_audit_guard();
exception when duplicate_object then null; end $$;

-- ── Función: accept_consent_and_open_relay (R2-1a) ───────────────────────
-- Transición atómica del doble consentimiento. Una sola transacción plpgsql.
--
-- judgment-r3 item 6: p_party se usa con EXECUTE format('%I', col_name)
--   para el UPDATE dinámico de la columna aceptada — nunca concatenación.
-- judgment-r3 item 8: estado = 'pending' único + booleans (no pending_a/b).
--
-- Concurrencia: dos accepts simultáneos compiten en el UPDATE; el primero
-- actualiza el estado, el segundo no encuentra fila que cumpla el WHERE y
-- devuelve no_op. El INSERT de relay_sessions tiene ON CONFLICT DO NOTHING
-- + UNIQUE(consent_session_id) para garantizar exactamente un relay.

create or replace function public.accept_consent_and_open_relay(
  p_consent_id uuid,
  p_party      text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col_accepted  text;
  v_col_other     text;
  v_state         text;
  v_searcher_ch   uuid;
  v_registrant_ch uuid;
begin
  -- Validate party (judgment-r3 item 6: safe comparison, not dynamic SQL for this).
  if p_party not in ('searcher', 'registrant') then
    raise exception 'accept_consent_and_open_relay: p_party debe ser ''searcher'' o ''registrant''';
  end if;

  -- Resolve column names for dynamic UPDATE (judgment-r3 item 6: use %I, no concat).
  v_col_accepted := case p_party
    when 'searcher'   then 'searcher_accepted'
    when 'registrant' then 'registrant_accepted'
  end;
  v_col_other := case p_party
    when 'searcher'   then 'registrant_accepted'
    when 'registrant' then 'searcher_accepted'
  end;

  -- Atomic UPDATE: mark this party as accepted. Lazy expiry: expires_at > now()
  -- is folded in so expired sessions return NOT FOUND (no_op).
  -- State transitions: pending → both_accepted when other party was already true.
  execute format(
    'update public.consent_sessions
     set %I = true,
         state = case when %I = true then ''both_accepted'' else state end
     where id = $1
       and state = ''pending''
       and expires_at > now()
     returning state, searcher_channel_id, registrant_channel_id',
    v_col_accepted,
    v_col_other
  ) using p_consent_id
    into v_state, v_searcher_ch, v_registrant_ch;

  if not found then
    -- Session expired, already resolved, or concurrent double-accept won first.
    return 'no_op';
  end if;

  if v_state = 'both_accepted' then
    -- Open relay: ON CONFLICT DO NOTHING + UNIQUE(consent_session_id) guarantee
    -- exactly one relay even if two concurrent accepts both reach here.
    insert into public.relay_sessions (
      consent_session_id,
      party_a_channel_id,
      party_b_channel_id,
      state
    )
    values (p_consent_id, v_searcher_ch, v_registrant_ch, 'active')
    on conflict (consent_session_id) do nothing;

    return 'both_accepted';
  end if;

  return 'accepted_one';
end;
$$;

grant execute on function public.accept_consent_and_open_relay(uuid, text)
  to service_role;

-- ── Función: close_relays_and_delete_contact (R2-1b) ─────────────────────
-- Borrado atómico: cierra relays, notifica al otro lado, anonimiza auditoría,
-- borra el contacto (cascade: channels, consent_sessions, relay_sessions).
--
-- judgment-r3 item 7: RETURNS TABLE(relay_id uuid, other_channel_id uuid).
-- La notificación INSERT ocurre ANTES del DELETE (en la misma tx) para
-- evitar cualquier ventana donde el relay esté cerrado pero sin notificar.
--
-- notifications.channel_id es ON DELETE SET NULL (0008 lo garantiza arriba),
-- por lo que la fila de notificación del OTRO canal sobrevive incluso si ese
-- canal se borra en el futuro.

create or replace function public.close_relays_and_delete_contact(
  p_contact_id uuid
)
returns table(relay_id uuid, other_channel_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relay_row record;
  v_my_channel_id uuid;
begin
  -- Find all channels belonging to this contact.
  -- For each active relay where one of those channels participates, collect
  -- the relay_id and the OTHER party's channel_id.

  for v_relay_row in
    select
      rs.id         as r_id,
      case
        when rs.party_a_channel_id = ch.id then rs.party_b_channel_id
        else rs.party_a_channel_id
      end as other_ch_id
    from public.relay_sessions rs
    join public.channels ch
      on ch.id in (rs.party_a_channel_id, rs.party_b_channel_id)
    where ch.contact_id = p_contact_id
      and rs.state = 'active'
  loop
    -- Close the relay.
    update public.relay_sessions
      set state = 'closed'
    where id = v_relay_row.r_id;

    -- Notify the other party BEFORE delete (same tx = atomic).
    insert into public.notifications (
      channel_id,
      tipo,
      prioridad,
      payload,
      estado
    ) values (
      v_relay_row.other_ch_id,
      'info',
      'normal',
      jsonb_build_object(
        'mensaje',
        'El otro participante del canal de reencuentro canceló su cuenta. El canal ha sido cerrado.'
      ),
      'pendiente'
    );

    -- Anonymize audit rows for this contact (partial trigger allows this).
    update public.auto_connection_audit
      set searcher_contact_id    = null,
          registrant_contact_id  = null
    where (searcher_contact_id = p_contact_id
       or  registrant_contact_id = p_contact_id);

    -- Return the relay row to the caller.
    relay_id        := v_relay_row.r_id;
    other_channel_id := v_relay_row.other_ch_id;
    return next;
  end loop;

  -- Delete the contact (cascade: channels → consent_sessions / relay_sessions).
  -- notifications.channel_id is ON DELETE SET NULL — no orphan issue.
  delete from public.contacts where id = p_contact_id;
end;
$$;

grant execute on function public.close_relays_and_delete_contact(uuid)
  to service_role;

-- ── Índices ───────────────────────────────────────────────────────────────

-- Buscar la sesión de consentimiento pendiente de un match (routing).
create index if not exists consent_sessions_match_pending_idx
  on public.consent_sessions (match_id)
  where state = 'pending';

-- Resolver relays activos de un canal (intercept pre-máquina).
create index if not exists relay_sessions_active_idx
  on public.relay_sessions (party_a_channel_id, party_b_channel_id)
  where state = 'active';

-- Auditoría por match (reporting).
create index if not exists auto_connection_audit_match_idx
  on public.auto_connection_audit (match_id);
