-- Sucursales como origen físico de las configuraciones y cotizaciones.

create table if not exists sucursales (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  provincia text not null,
  localidad text not null,
  direccion text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nombre, provincia, localidad)
);

create index if not exists idx_sucursales_activas_nombre
  on sucursales (nombre) where activa;

alter table sucursales enable row level security;
create policy sucursales_read_authenticated on sucursales
  for select using (auth.role() = 'authenticated');
create policy sucursales_admin_write on sucursales
  for all using (public.es_admin()) with check (public.es_admin());

alter table configuraciones_envio
  add column if not exists origen_sucursal_id uuid references sucursales(id) on delete set null;
create index if not exists idx_config_origen_sucursal
  on configuraciones_envio (origen_sucursal_id);

alter table configuraciones_envio
  add column if not exists modo_precio_pallet text not null default 'precio_por_unidad'
  check (modo_precio_pallet in ('precio_por_unidad', 'precio_total_tramo'));

alter table perfiles_usuario
  add column if not exists origen_predeterminado_sucursal_id uuid references sucursales(id) on delete set null;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sucursales_updated_at on sucursales;
create trigger trg_sucursales_updated_at
  before update on sucursales
  for each row execute function set_updated_at();

-- Reemplaza la función previa para que una copia conserve la sucursal de origen.
create or replace function public.duplicar_configuracion(configuracion_origen uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen public.configuraciones_envio;
  v_nueva_id uuid;
  v_nombre_copia text;
begin
  if auth.role() <> 'authenticated' or not public.es_admin() then
    raise exception 'No tenes permisos para duplicar configuraciones';
  end if;
  select * into v_origen from public.configuraciones_envio where id = configuracion_origen;
  if not found then raise exception 'Configuracion no encontrada'; end if;
  v_nombre_copia := 'Copia ' || (
    select count(*) + 1 from public.configuraciones_envio where configuracion_origen_id = configuracion_origen
  );
  insert into public.configuraciones_envio (
    transporte_id, origen_sucursal_id, origen_provincia, origen_localidad, origen_nombre_personalizado,
    origen_ubicacion_personalizada_id, destino_provincia, destino_localidad,
    destino_nombre_personalizado, destino_ubicacion_personalizada_id,
    tiempo_estimado_min_horas, tiempo_estimado_max_horas, precio_pallet,
    modo_precio_pallet, precio_camion_completo, precio_camion_actualizado_at,
    apto_peritoneal, activo, es_copia, configuracion_origen_id, nombre_copia
  ) values (
    v_origen.transporte_id, v_origen.origen_sucursal_id, v_origen.origen_provincia,
    v_origen.origen_localidad, v_origen.origen_nombre_personalizado,
    v_origen.origen_ubicacion_personalizada_id, v_origen.destino_provincia,
    v_origen.destino_localidad, v_origen.destino_nombre_personalizado,
    v_origen.destino_ubicacion_personalizada_id, v_origen.tiempo_estimado_min_horas,
    v_origen.tiempo_estimado_max_horas, v_origen.precio_pallet,
    v_origen.modo_precio_pallet, v_origen.precio_camion_completo,
    v_origen.precio_camion_actualizado_at, v_origen.apto_peritoneal,
    v_origen.activo, true, configuracion_origen, v_nombre_copia
  ) returning id into v_nueva_id;
  insert into public.tarifas_bulto (configuracion_id, desde_bulto, precio, es_valor_inicial, updated_at)
    select v_nueva_id, desde_bulto, precio, es_valor_inicial, updated_at from public.tarifas_bulto where configuracion_id = configuracion_origen;
  insert into public.tarifas_pallet (configuracion_id, desde_pallet, precio, updated_at)
    select v_nueva_id, desde_pallet, precio, updated_at from public.tarifas_pallet where configuracion_id = configuracion_origen;
  if to_regclass('public.tarifas_kg') is not null then
    execute 'insert into public.tarifas_kg (configuracion_id, desde_kg, precio, updated_at) select $1, desde_kg, precio, updated_at from public.tarifas_kg where configuracion_id = $2'
      using v_nueva_id, configuracion_origen;
  end if;
  insert into public.configuracion_tags (configuracion_id, tag_id)
    select v_nueva_id, tag_id from public.configuracion_tags where configuracion_id = configuracion_origen;
  insert into public.configuracion_tag_precios (configuracion_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo)
    select v_nueva_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo from public.configuracion_tag_precios where configuracion_id = configuracion_origen;
  return v_nueva_id;
end;
$$;
