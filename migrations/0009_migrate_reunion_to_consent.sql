-- SomosVenezuela · Migración 0009_migrate_reunion_to_consent
-- MIGRACIÓN DE DATOS: Modelo A (matches.reunion_estado) → Modelo B (consent_sessions).
--
-- PROPÓSITO: Script de corte único para transferir las reuniones EN CURSO del
-- Modelo A al Modelo B antes de redirigir el flujo de producción.
-- Ejecutar DESPUÉS de 0008 (que crea consent_sessions).
-- NUNCA ejecutar antes de 0008; el runner ledger garantiza el orden.
--
-- CUÁNDO EJECUTAR: Solo en el corte de transición (ver docs/corte-modelo-b.md).
-- Requiere OK explícito de la dueña del proyecto antes de correr en prod.
-- Esta migración es SOLO lectura del Modelo A + escritura en B.
-- NO toca ni borra columnas de A (la deprecación de A es un paso posterior).
--
-- IDEMPOTENCIA: ON CONFLICT DO NOTHING en el INSERT garantiza que re-ejecutar
-- esta migración no duplica consent_sessions. La UNIQUE sobre match_id
-- (constraint migrated_from_match_unique) es la guarda adicional.
--
-- DECISIÓN DE DISEÑO — 'intercambiado' sin relay_session:
--   Las reuniones con reunion_estado='intercambiado' del Modelo A ya compartieron
--   el contacto punto-a-punto (notificación en claro). No existe relay_session
--   correspondiente porque el relay solo nace en el flujo nuevo (Modelo B) a
--   partir de both_accepted activo. Migrar a state='both_accepted' sin relay es
--   correcto: representa el hecho histórico de que ambas partes consintieron y
--   el contacto ya fue entregado. No abre ningún canal nuevo ni expone PII.
--
-- FILAS OMITIDAS (sin datos suficientes):
--   Si un match no tiene buscador_contact_id (search FK null o search borrada),
--   o no tiene person_id / persons.contact_id, la fila se OMITE.
--   Es preferible omitir que crear una consent_session corrupta con FKs null.
--   Las filas omitidas deben revisarse manualmente durante el corte.
--
-- CANAL (channel_id): se selecciona el PRIMER canal por contact_id (orden por
--   created_at asc). Si el contacto no tiene canales, la fila se omite.
--   Justificación: el Modelo A nunca distinguía canal; el Modelo B necesita uno
--   para las notificaciones futuras. En los casos 'intercambiado' ya no importa
--   para el flujo (la entrega ya ocurrió), pero la FK es NOT NULL; por eso
--   omitimos en lugar de insertar con NULL.
--
-- EXPIRES_AT: las sesiones migradas se fijan a 9999-12-31 para indicar que no
--   tienen caducidad natural (el consentimiento ya fue resuelto o está en curso
--   con información completa del Modelo A). El sweep no las toca porque
--   'both_accepted' y 'declined' no son estados 'pending'.

-- ── Constraint de idempotencia ────────────────────────────────────────────
-- Garantiza que no puede haber dos consent_sessions para el mismo match_id
-- migrado desde el Modelo A. Si la constraint ya existe (re-run), el bloque
-- DO captura el error sin abortar.
do $$ begin
  alter table public.consent_sessions
    add constraint migrated_from_match_unique unique (match_id);
exception when duplicate_object then null; end $$;

comment on constraint migrated_from_match_unique on public.consent_sessions is
  'Idempotencia de la migración 0009: exactamente una consent_session por match_id migrado desde el Modelo A.';

-- ── INSERT principal ──────────────────────────────────────────────────────
-- Transfiere cada match con reunion_estado <> 'inactiva' a consent_sessions.
-- Las filas sin contact_id resolvible (buscador o registrante) se omiten
-- mediante los JOIN INNER (no LEFT JOIN): si algún JOIN falla, la fila no
-- aparece en el SELECT y no se inserta.
insert into public.consent_sessions (
  match_id,
  searcher_contact_id,
  registrant_contact_id,
  searcher_channel_id,
  registrant_channel_id,
  searcher_accepted,
  registrant_accepted,
  state,
  created_at,
  expires_at
)
select
  m.id                        as match_id,
  s.buscador_contact_id       as searcher_contact_id,
  p.contact_id                as registrant_contact_id,
  ch_s.id                     as searcher_channel_id,
  ch_r.id                     as registrant_channel_id,

  -- El buscador siempre aceptó cuando inició el reencuentro (flujo síncrono
  -- del Modelo A: consentimiento_buscador pasa a 'aceptado' al iniciar).
  -- Sin embargo, usamos el valor real de la columna para mayor fidelidad.
  (m.consentimiento_buscador = 'aceptado')    as searcher_accepted,

  (m.consentimiento_registrante = 'aceptado') as registrant_accepted,

  -- Mapeo de reunion_estado → state del Modelo B:
  --   pendiente     → 'pending'        (registrante aún no respondió)
  --   intercambiado → 'both_accepted'  (ambos consintieron; contacto ya entregado)
  --   rechazada     → 'declined'       (alguna parte rechazó)
  case m.reunion_estado
    when 'pendiente'     then 'pending'
    when 'intercambiado' then 'both_accepted'
    when 'rechazada'     then 'declined'
  end                         as state,

  -- Conservar el timestamp original del match como referencia histórica.
  m.created_at                as created_at,

  -- expires_at: sesiones ya resueltas (both_accepted, declined) o en-curso
  -- migradas no caducan naturalmente. Se fija al máximo representable.
  -- El sweep ignora estados distintos a 'pending', así que no afecta ops.
  '9999-12-31T23:59:59Z'::timestamptz as expires_at

from public.matches m

-- Resolver la búsqueda del buscador (INNER: omite si search fue borrada o null).
join public.searches s
  on s.id = m.search_id
 and s.buscador_contact_id is not null

-- Resolver el contacto del registrante (INNER: omite si person/contact null).
join public.persons p
  on p.id = m.person_id
 and p.contact_id is not null

-- Primer canal del buscador (INNER: omite si no tiene ningún canal registrado).
join lateral (
  select id from public.channels
  where contact_id = s.buscador_contact_id
  order by created_at asc
  limit 1
) ch_s on true

-- Primer canal del registrante (INNER: omite si no tiene ningún canal).
join lateral (
  select id from public.channels
  where contact_id = p.contact_id
  order by created_at asc
  limit 1
) ch_r on true

-- Solo migrar reuniones en curso (no inactivas).
where m.reunion_estado in ('pendiente', 'intercambiado', 'rechazada')
  -- Guardar coherencia: no migrar filas sin pet_id válido que deberían ser
  -- revisadas por el equipo (matches de mascotas no usan el mismo flujo).
  and m.pet_id is null

on conflict (match_id) do nothing;
-- ON CONFLICT sobre la constraint migrated_from_match_unique: re-runs seguros.

-- ── Nota de verificación post-corte ───────────────────────────────────────
-- Después de ejecutar esta migración en el corte, verificar:
--   SELECT count(*) FROM public.consent_sessions WHERE match_id IS NOT NULL;
--   (debe coincidir con el número de matches con reunion_estado <> 'inactiva' y pet_id IS NULL
--    que tenían contact_ids y canales resolvibles)
--
-- Para identificar filas OMITIDAS (revisar manualmente):
--   SELECT m.id, m.reunion_estado, m.search_id, m.person_id
--   FROM public.matches m
--   WHERE m.reunion_estado <> 'inactiva'
--     AND m.pet_id IS NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM public.consent_sessions cs WHERE cs.match_id = m.id
--     );
