-- SomosVenezuela · Migracion 0004_pets_search_rpc
-- Funcion de busqueda publica difusa (pg_trgm) sobre pets_public.
-- Fase 6 (T6.2): registro y busqueda de mascotas. Espeja EXACTAMENTE
-- search_persons_public (migracion 0003) pero sobre la vista pets_public.
--
-- CLAVE DE PRIVACIDAD: la funcion lee de la VISTA public.pets_public, que ya
-- excluye contact_id. No toca la tabla base ni reintroduce esa columna. La anon
-- key la invoca via RPC (grant explicito). Identico modelo de privacidad que la
-- busqueda de personas.

-- ── Funcion de busqueda ─────────────────────────────────────────────
-- Devuelve las columnas publicas + un score [0..1] = similitud trigram maxima
-- entre el termino y (nombre, tipo, raza, zona). Si se pasa zona, filtra ademas
-- por similitud de zona. Orden: score desc, created_at desc.
create or replace function public.search_pets_public(
  q    text,
  zona_filtro text default null
)
returns table (
  id           uuid,
  nombre       text,
  tipo         text,
  raza         text,
  zona         text,
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
    p.id, p.nombre, p.tipo, p.raza, p.zona, p.foto_url,
    p.estado, p.fuente, p.verificacion, p.created_at, p.updated_at,
    greatest(
      public.similarity(coalesce(p.nombre, ''), coalesce(q, '')),
      public.similarity(coalesce(p.tipo, ''),   coalesce(q, '')),
      public.similarity(coalesce(p.raza, ''),   coalesce(q, '')),
      public.similarity(coalesce(p.zona, ''),   coalesce(q, ''))
    ) as score
  from public.pets_public p
  where
    -- termino libre: alguna de las columnas debe parecerse al query.
    -- Operador % calificado con esquema (operator(public.%)) porque search_path=''.
    (
      coalesce(q, '') = ''
      or p.nombre operator(public.%) q
      or p.tipo   operator(public.%) q
      or p.raza   operator(public.%) q
      or p.zona   operator(public.%) q
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
-- tambien. La funcion solo expone columnas publicas via pets_public.
grant execute on function public.search_pets_public(text, text)
  to anon, authenticated, service_role;
