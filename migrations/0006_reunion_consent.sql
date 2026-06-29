-- SomosVenezuela · Migración 0006_reunion_consent
-- Consentimiento BILATERAL para reunir a quien busca con quien registró (Capa 2,
-- el corazón de la misión: reunir familias). Es SENSIBLE: habilita el intercambio
-- de contacto entre dos personas, pero SOLO con el «sí» explícito de AMBAS.
--
-- DECISIÓN DE MODELO: columnas en `matches` (no tabla nueva). Un `match` YA es el
-- par buscador (searches.buscador_contact_id) ↔ persona registrada (persons.contact_id):
-- es el lugar natural para registrar el consentimiento de cada parte. Una columna
-- por parte + un estado de reunión es lo más limpio y no duplica el grafo de datos.
--
-- PRIVACIDAD (guardrail #1): estas columnas NO añaden PII. `matches` ya nace con RLS
-- deny-all (0002_rls_policies) y sin grants a las claves públicas: solo el backend
-- (service_role) lee/escribe. El contacto en claro vive en `contacts` (sensible) y
-- SOLO se comparte, punto a punto, en la notificación final tras el doble «sí». No
-- se expone en ninguna vista pública ni en los listados de revisión.
--
-- GUARDRAIL #2 (antitrata / menores): el inicio del reencuentro lo bloquea el
-- backend si la persona es menor (edad<18 o fila en `minors`); ese caso requiere una
-- entidad verificada y nunca se conecta de forma automática. Esta migración no afloja
-- ese gate: persons_public (0002) ya excluye menores y el dominio lo refuerza.
--
-- Idempotente donde es posible. Ejecuta sobre la BD ya migrada hasta 0005.

-- ── Estado de consentimiento de cada parte ──────────────────────────
-- Ciclo de vida por parte:
--   sin_solicitar → (se inicia un reencuentro) → solicitado → aceptado | rechazado
-- El buscador, que inicia en conversación activa, pasa directo a 'aceptado' (su
-- consentimiento es síncrono). Al registrante se le pide ('solicitado') y responde.
alter table public.matches
  add column if not exists consentimiento_buscador text not null default 'sin_solicitar',
  add column if not exists consentimiento_registrante text not null default 'sin_solicitar',
  -- Estado del reencuentro a nivel de match (resume el cruce de ambas partes):
  --   inactiva      → nadie ha pedido conectar todavía (estado por defecto).
  --   pendiente     → el buscador aceptó y se espera la respuesta del registrante.
  --   intercambiado → AMBOS aceptaron: se compartieron los contactos (único punto).
  --   rechazada     → alguna parte rechazó: se cerró sin compartir nada.
  add column if not exists reunion_estado text not null default 'inactiva';

-- CHECKs de dominio: espejan los enums de la capa de aplicación (zod). Se añaden por
-- separado para poder tolerar una re-ejecución (los ADD COLUMN son idempotentes; los
-- CHECK no llevan IF NOT EXISTS, así que los envolvemos para no fallar si ya existen).
do $$ begin
  alter table public.matches
    add constraint matches_consentimiento_buscador_check
    check (consentimiento_buscador in ('sin_solicitar','solicitado','aceptado','rechazado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.matches
    add constraint matches_consentimiento_registrante_check
    check (consentimiento_registrante in ('sin_solicitar','solicitado','aceptado','rechazado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.matches
    add constraint matches_reunion_estado_check
    check (reunion_estado in ('inactiva','pendiente','intercambiado','rechazada'));
exception when duplicate_object then null; end $$;

comment on column public.matches.consentimiento_buscador is
  'Consentimiento de QUIEN BUSCA para conectar en este match. Síncrono: pasa a aceptado al iniciar el reencuentro. Enum: sin_solicitar|solicitado|aceptado|rechazado.';
comment on column public.matches.consentimiento_registrante is
  'Consentimiento de QUIEN REGISTRÓ a la persona. Asíncrono: se le pide (solicitado) y responde /conectar o /rechazar. Enum igual al del buscador.';
comment on column public.matches.reunion_estado is
  'Estado del reencuentro del match. El intercambio de contacto SOLO ocurre con reunion_estado=intercambiado, alcanzable únicamente con doble consentimiento aceptado.';

-- ── Índice para resolver la solicitud PENDIENTE del registrante ─────
-- El registrante responde por un comando GLOBAL (/conectar | /rechazar) que NO lleva
-- el id del match: el backend lo correlaciona buscando su solicitud pendiente. La
-- consulta natural es «matches con consentimiento_registrante='solicitado'»; este
-- índice parcial la acelera sin pesar sobre el resto de la tabla.
create index if not exists matches_reunion_solicitada_idx
  on public.matches (consentimiento_registrante)
  where consentimiento_registrante = 'solicitado';

-- Nota deliberada: NO se crea vista pública de matches (igual que en 0002). El
-- consentimiento es flujo interno; el contacto solo viaja en la notificación final
-- punto a punto tras el doble «sí». Las claves públicas (anon/authenticated) siguen
-- sin tocar `matches` (deny-all + revoke de 0002 cubren las nuevas columnas).
