-- SomosVenezuela · Migración inicial (0001_init)
-- PostgreSQL / Supabase. Crea extensiones, enums, tablas, índices y RLS.
-- Idempotente donde es posible. Ejecuta en una BD limpia.

-- ── Extensiones ─────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";     -- búsqueda difusa por similitud

-- ── Enums ───────────────────────────────────────────────────
do $$ begin
  create type estado_persona as enum
    ('desaparecida','encontrada_viva','encontrada_herida','fallecida','reunida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fuente_dato as enum
    ('propia','cruz_roja','ocha','hospital','refugio','plataforma_aliada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_verificacion as enum ('verificada','sin_verificar');
exception when duplicate_object then null; end $$;

do $$ begin
  create type plataforma_canal as enum ('telegram','whatsapp');
exception when duplicate_object then null; end $$;

-- ── Contactos (SENSIBLE) ────────────────────────────────────
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  telefono      text,                       -- SENSIBLE: nunca público
  email         text,                       -- SENSIBLE
  solo_uso_interno boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── Canales (SENSIBLE) ──────────────────────────────────────
create table if not exists channels (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  plataforma  plataforma_canal not null,
  chat_id     text not null,                -- SENSIBLE
  opt_in      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Fuentes ─────────────────────────────────────────────────
create table if not exists sources (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  tipo      text not null check (tipo in ('api','pdf','imagen')),
  terminos_url text,
  permiso_uso boolean not null default false,
  atribucion_requerida boolean not null default false
);

-- ── Personas ────────────────────────────────────────────────
create table if not exists persons (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  apellidos     text,
  edad          int check (edad is null or (edad >= 0 and edad < 130)),
  zona          text,
  descripcion   text,
  foto_url      text,
  estado        estado_persona not null default 'desaparecida',
  fuente        fuente_dato not null default 'propia',
  verificacion  estado_verificacion not null default 'sin_verificar',
  contact_id    uuid references contacts(id) on delete set null,  -- interna
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- GUARDRAIL: 'fallecida' exige fuente verificada (refuerza en dominio también)
  constraint fallecida_requiere_verificacion
    check (estado <> 'fallecida' or verificacion = 'verificada')
);
create index if not exists persons_nombre_trgm on persons using gin (nombre gin_trgm_ops);
create index if not exists persons_desc_trgm  on persons using gin (descripcion gin_trgm_ops);
create index if not exists persons_zona_idx    on persons (zona);
create index if not exists persons_estado_idx  on persons (estado);

-- ── Mascotas ────────────────────────────────────────────────
create table if not exists pets (
  id           uuid primary key default gen_random_uuid(),
  nombre       text,
  tipo         text,
  raza         text,
  zona         text,
  foto_url     text,
  estado       estado_persona not null default 'desaparecida',
  fuente       fuente_dato not null default 'propia',
  verificacion estado_verificacion not null default 'sin_verificar',
  contact_id   uuid references contacts(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists pets_nombre_trgm on pets using gin (nombre gin_trgm_ops);

-- ── Menores (refuerzo, 1–1 con persons) ─────────────────────
create table if not exists minors (
  id                   uuid primary key default gen_random_uuid(),
  person_id            uuid not null unique references persons(id) on delete cascade,
  tutor_conocido       text,
  entidad_verificadora uuid references sources(id),
  entrega_confirmada   boolean not null default false,
  confirmada_por       uuid references sources(id),
  notas                text,                 -- SENSIBLE
  created_at           timestamptz not null default now()
  -- GUARDRAIL (reforzar en dominio): entrega_confirmada solo si entidad verificadora válida
);

-- ── Búsquedas ───────────────────────────────────────────────
create table if not exists searches (
  id                 uuid primary key default gen_random_uuid(),
  buscador_contact_id uuid references contacts(id) on delete set null, -- SENSIBLE
  tipo               text not null check (tipo in ('persona','mascota')),
  target_nombre      text,
  target_descripcion text,
  zona               text,
  created_at         timestamptz not null default now()
);
create index if not exists searches_nombre_trgm on searches using gin (target_nombre gin_trgm_ops);

-- ── Coincidencias ───────────────────────────────────────────
create table if not exists matches (
  id             uuid primary key default gen_random_uuid(),
  search_id      uuid references searches(id) on delete cascade,
  person_id      uuid references persons(id) on delete cascade,
  pet_id         uuid references pets(id) on delete cascade,
  score          numeric(4,3) not null check (score >= 0 and score <= 1),
  metodo         text not null check (metodo in ('exacto','trigram','ia')),
  estado_revision text not null default 'propuesto'
                 check (estado_revision in ('propuesto','confirmado','descartado')),
  revisado_por   text,
  created_at     timestamptz not null default now(),
  check (person_id is not null or pet_id is not null)
);

-- ── Mensajes "estoy vivo" ───────────────────────────────────
create table if not exists alive_messages (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid references persons(id) on delete set null,
  autor_nombre text,
  tipo         text not null check (tipo in ('texto','voz')),
  contenido    text,        -- texto o URL del audio
  zona         text,
  entregado    boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ── Zonas y necesidades ─────────────────────────────────────
create table if not exists zones (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  lat             double precision,
  lng             double precision,
  estado          text,
  actualizado_por text,
  updated_at      timestamptz not null default now()
);
create table if not exists needs (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid not null references zones(id) on delete cascade,
  tipo        text not null,           -- agua | medicinas | rescatistas | ...
  urgencia    text not null check (urgencia in ('baja','media','alta','critica')),
  descripcion text,
  updated_at  timestamptz not null default now()
);

-- ── Satélite ────────────────────────────────────────────────
create table if not exists sat_tiles (
  id          uuid primary key default gen_random_uuid(),
  bbox        text,                    -- o geometría; bbox simple para empezar
  fuente_img  text check (fuente_img in ('copernicus','sentinel','maxar')),
  fecha_img   date,
  url         text,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','en_revision','cerrada'))
);
create table if not exists sat_detections (
  id          uuid primary key default gen_random_uuid(),
  tile_id     uuid not null references sat_tiles(id) on delete cascade,
  origen      text not null check (origen in ('ia','humano')),
  tipo        text not null check (tipo in ('cambio','objeto','senal')),
  confianza   numeric(4,3) not null check (confianza >= 0 and confianza <= 1),
  lat         double precision,
  lng         double precision,
  validado_por text,
  created_at  timestamptz not null default now()
);
create table if not exists sat_alerts (
  id          uuid primary key default gen_random_uuid(),
  tile_id     uuid references sat_tiles(id) on delete set null,
  lat         double precision,
  lng         double precision,
  confianza   numeric(4,3) not null check (confianza >= 0 and confianza <= 1),
  consenso    boolean not null default false,   -- ia + humano
  exportada   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── Notificaciones ──────────────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id) on delete cascade,
  channel_id  uuid references channels(id) on delete set null,
  tipo        text not null check (tipo in ('match','alerta','info')),
  prioridad   text not null default 'normal' check (prioridad in ('normal','alta')),
  payload     jsonb,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','enviada','fallida')),
  created_at  timestamptz not null default now()
);

-- ── Row Level Security en datos sensibles ───────────────────
-- Activa RLS; las políticas concretas (rol de servicio) se definen en el backend.
alter table contacts      enable row level security;
alter table channels      enable row level security;
alter table notifications enable row level security;
alter table minors        enable row level security;

-- Por defecto, sin políticas = acceso solo con service_role (backend). Los datos
-- públicos (persons/pets/zones/needs) se leen vía API que NUNCA expone contact_id.

-- ── updated_at automático ───────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

do $$ begin
  create trigger persons_updated before update on persons
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger pets_updated before update on pets
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
