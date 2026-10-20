-- Índices y búsqueda bajo demanda para el asistente de actualización masiva.
create extension if not exists pg_trgm with schema extensions;

create or replace function public.normalizar_nombre_transporte(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select translate(lower(coalesce(p_texto, '')),
    'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
$$;

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_catalog.pg_opclass c
  join pg_catalog.pg_namespace n on n.oid = c.opcnamespace
  join pg_catalog.pg_am am on am.oid = c.opcmethod
  where c.opcname = 'gin_trgm_ops' and am.amname = 'gin'
  limit 1;

  if v_schema is null then
    raise exception 'No se encontró la clase gin_trgm_ops de pg_trgm.';
  end if;

  execute format(
    'create index if not exists idx_transportes_nombre_busqueda_trgm on public.transportes using gin (public.normalizar_nombre_transporte(coalesce(nombre_fantasia, '''') || '' '' || razon_social) %I.gin_trgm_ops)',
    v_schema
  );
end;
$$;

create or replace function public.buscar_transportes_actualizacion_precios(p_busqueda text)
returns table (id uuid, razon_social text, nombre_fantasia text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_busqueda text := public.normalizar_nombre_transporte(trim(coalesce(p_busqueda, '')));
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Permiso denegado: solo administradores pueden buscar transportes para actualización de precios.'
      using errcode = '42501';
  end if;
  if length(v_busqueda) < 1 then
    return;
  end if;

  return query
    select t.id, t.razon_social, t.nombre_fantasia
    from public.transportes t
    where public.normalizar_nombre_transporte(coalesce(t.nombre_fantasia, '') || ' ' || t.razon_social)
      like '%' || v_busqueda || '%'
    order by coalesce(t.nombre_fantasia, t.razon_social), t.razon_social
    limit 10;
end;
$$;

revoke all on function public.buscar_transportes_actualizacion_precios(text) from public;
grant execute on function public.buscar_transportes_actualizacion_precios(text) to authenticated;
