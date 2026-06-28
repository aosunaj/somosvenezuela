-- SomosVenezuela · Migracion 0003_search_rpc
-- Funcion de busqueda publica difusa (pg_trgm) sobre persons_public.
-- Spec 01: busqueda por nombre/zona/descripcion, tolerante a errores, ordenada
-- por probabilidad (score), con fuente y verificacion visibles y SIN contacto.
--
-- CLAVE DE PRIVACIDAD: la funcion lee de la VISTA public.persons_public, que ya
-- excluye menores (edad<18 o fila en minors) y contact_id. No toca la tabla base
-- ni reintroduce esas columnas. La anon key la invoca via RPC (grant explicito).

-- ── Funcion de busqueda ─────────────────────────────────────────────
-- Devuelve las columnas publicas + un score [0..1] = similitud trigram maxima
-- entre el termino y (nombre, zona, descripcion). Si se pasa zona, filtra ademas
-- por similitud de zona. Orden: score desc.
create or replace function public.search_persons_public(
  q    text,
  zona_filtro text default null
)
returns table (
  id           uuid,
  nombre       text,
  apellidos    text,
  edad         int,
  zona         text,
  descripcion  text,
  foto_url     text,
  estado       estado_persona,
  fuente       fuente_dato,
  verificacion estado_verificacion,
  created_at   timestamptz,
  updated_at   timestamptz,
  score        real
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.nombre, p.apellidos, p.edad, p.zona, p.descripcion, p.foto_url,
    p.estado, p.fuente, p.verificacion, p.created_at, p.updated_at,
    greatest(
      public.similarity(coalesce(p.nombre, ''),      coalesce(q, '')),
      public.similarity(coalesce(p.zona, ''),         coalesce(q, '')),
      public.similarity(coalesce(p.descripcion, ''),  coalesce(q, ''))
    ) as score
  from public.persons_public p
  where
    -- termino libre: alguna de las columnas debe parecerse al query.
    -- Operador % calificado con esquema (operator(public.%)) porque search_path=''.
    (
      coalesce(q, '') = ''
      or p.nombre      operator(public.%) q
      or p.zona        operator(public.%) q
      or p.descripcion operator(public.%) q
    )
    -- filtro opcional por zona (tolerante a errores)
    and (
      zona_filtro is null
      or zona_filtro = ''
      or p.zona operator(public.%) zona_filtro
    )
  order by score desc, p.created_at desc
  limit 50;
$$;

-- ── Permisos ────────────────────────────────────────────────────────
-- La web (anon/authenticated) puede invocar la RPC. El backend (service_role)
-- tambien. La funcion solo expone columnas publicas via persons_public.
grant execute on function public.search_persons_public(text, text)
  to anon, authenticated, service_role;
