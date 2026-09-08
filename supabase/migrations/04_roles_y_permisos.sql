-- =========================================================
-- MIGRACION 04: roles operario/admin y permisos efectivos
-- Ejecutar despues de las migraciones anteriores.
-- =========================================================

update perfiles_usuario
set rol = 'operario'
where rol in ('compras', 'licitaciones', 'gerencia');

alter table perfiles_usuario drop constraint if exists perfiles_usuario_rol_check;
alter table perfiles_usuario add constraint perfiles_usuario_rol_check
  check (rol in ('operario', 'admin'));

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles_usuario
    where id = auth.uid() and rol = 'admin'
  );
$$;

drop policy if exists auth_write_transportes on transportes;
create policy admin_write_transportes on transportes
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists auth_write_config on configuraciones_envio;
create policy admin_write_config on configuraciones_envio
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists auth_write_tarifas on tarifas_bulto;
create policy admin_write_tarifas on tarifas_bulto
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists auth_write_tags on tags;
create policy admin_write_tags on tags
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists auth_write_config_tags on configuracion_tags;
create policy admin_write_config_tags on configuracion_tags
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists auth_read_perfil_propio on perfiles_usuario;
create policy read_own_or_admin_profiles on perfiles_usuario
  for select using (auth.uid() = id or public.es_admin());

drop policy if exists auth_write_perfil_propio on perfiles_usuario;
create policy update_own_profile on perfiles_usuario
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy insert_own_profile on perfiles_usuario
  for insert with check (auth.uid() = id);
create policy admin_write_profiles on perfiles_usuario
  for all using (public.es_admin()) with check (public.es_admin());

do $$
begin
  if to_regclass('public.tarifas_pallet') is not null then
    execute 'drop policy if exists auth_write_tarifas_pallet on public.tarifas_pallet';
    execute 'create policy admin_write_tarifas_pallet on public.tarifas_pallet for all using (public.es_admin()) with check (public.es_admin())';
  end if;
end $$;