-- Mantiene los permisos actuales y permite que Postgres evalúe estos checks
-- una vez por sentencia, en vez de recalcularlos por cada fila candidata.
drop policy if exists auth_read_transportes on public.transportes;
create policy auth_read_transportes on public.transportes
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists admin_write_transportes on public.transportes;
create policy admin_write_transportes on public.transportes
  for all using ((select public.es_admin()))
  with check ((select public.es_admin()));

drop policy if exists auth_read_config on public.configuraciones_envio;
create policy auth_read_config on public.configuraciones_envio
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists admin_write_config on public.configuraciones_envio;
create policy admin_write_config on public.configuraciones_envio
  for all using ((select public.es_admin()))
  with check ((select public.es_admin()));

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
    where t.activo
      and public.normalizar_nombre_transporte(coalesce(t.nombre_fantasia, '') || ' ' || t.razon_social)
        like '%' || v_busqueda || '%'
    order by
      case when public.normalizar_nombre_transporte(coalesce(t.nombre_fantasia, '')) like v_busqueda || '%'
          or public.normalizar_nombre_transporte(t.razon_social) like v_busqueda || '%'
        then 0 else 1 end,
      coalesce(t.nombre_fantasia, t.razon_social), t.razon_social
    limit 10;
end;
$$;

revoke all on function public.buscar_transportes_actualizacion_precios(text) from public;
grant execute on function public.buscar_transportes_actualizacion_precios(text) to authenticated;
