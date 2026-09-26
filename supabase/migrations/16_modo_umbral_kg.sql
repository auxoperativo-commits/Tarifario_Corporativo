-- =========================================================
-- MIGRACIÓN 16: Modelo único y normalizado para Precio por Kg
--
-- Consolida los tramos de kg en la tabla "tarifas_kg" con la columna
-- "umbral_kg" y agrega la columna "modo_umbral_kg" en "configuraciones_envio".
-- Permite los modos 'desde' (inclusive en adelante) y 'hasta' (umbral techo).
-- =========================================================

-- 1. Columna modo_umbral_kg en configuraciones_envio
alter table public.configuraciones_envio
  add column if not exists modo_umbral_kg text not null default 'desde'
  check (modo_umbral_kg in ('desde', 'hasta'));

-- 2. Consolidar/crear la tabla única tarifas_kg
create table if not exists public.tarifas_kg (
  id uuid primary key default uuid_generate_v4(),
  configuracion_id uuid not null references public.configuraciones_envio(id) on delete cascade,
  umbral_kg numeric not null check (umbral_kg > 0),
  precio numeric(12,2) not null check (precio >= 0),
  updated_at timestamptz not null default now()
);

-- Si la tabla ya existía con la columna antigua 'desde_kg', renombrarla a 'umbral_kg'
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'tarifas_kg' and column_name = 'desde_kg'
  ) and not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'tarifas_kg' and column_name = 'umbral_kg'
  ) then
    alter table public.tarifas_kg rename column desde_kg to umbral_kg;
  end if;
end $$;

-- Si existían tablas o estructuras heredadas como 'tarifas_kg_tramo', migrar datos
do $$
begin
  if to_regclass('public.tarifas_kg_tramo') is not null then
    execute '
      insert into public.tarifas_kg (configuracion_id, umbral_kg, precio, updated_at)
      select configuracion_id, coalesce(umbral_kg, desde_kg, 1), precio, coalesce(updated_at, now())
      from public.tarifas_kg_tramo
      on conflict do nothing
    ';
    drop table public.tarifas_kg_tramo cascade;
  end if;
end $$;

-- Asegurar constraint unique (configuracion_id, umbral_kg) en tarifas_kg
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'tarifas_kg'
      and constraint_name = 'tarifas_kg_configuracion_id_umbral_kg_key'
  ) then
    begin
      alter table public.tarifas_kg add constraint tarifas_kg_configuracion_id_umbral_kg_key unique (configuracion_id, umbral_kg);
    exception when others then
      null;
    end;
  end if;
end $$;

-- RLS para tarifas_kg
alter table public.tarifas_kg enable row level security;

drop policy if exists "auth_read_tarifas_kg" on public.tarifas_kg;
create policy "auth_read_tarifas_kg" on public.tarifas_kg
  for select using (auth.role() = 'authenticated');

drop policy if exists "auth_write_tarifas_kg" on public.tarifas_kg;
create policy "auth_write_tarifas_kg" on public.tarifas_kg
  for all using (auth.role() = 'authenticated');

-- Indice de performance para tarifas_kg
create index if not exists idx_tarifas_kg_config on public.tarifas_kg (configuracion_id);

-- 3. Actualizar función duplicar_configuracion para copiar modo_umbral_kg y tarifas_kg(umbral_kg)
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
    transporte_id, origen_sucursal_id, origen_grupo_id,
    origen_provincia, origen_localidad, origen_nombre_personalizado,
    origen_ubicacion_personalizada_id, destino_provincia, destino_localidad,
    destino_nombre_personalizado, destino_ubicacion_personalizada_id,
    tiempo_estimado_min_horas, tiempo_estimado_max_horas, precio_pallet,
    modo_precio_pallet, modo_umbral_kg, precio_camion_completo, precio_camion_actualizado_at,
    apto_peritoneal, activo, es_copia, configuracion_origen_id, nombre_copia
  ) values (
    v_origen.transporte_id, v_origen.origen_sucursal_id, v_origen.origen_grupo_id,
    v_origen.origen_provincia, v_origen.origen_localidad, v_origen.origen_nombre_personalizado,
    v_origen.origen_ubicacion_personalizada_id, v_origen.destino_provincia,
    v_origen.destino_localidad, v_origen.destino_nombre_personalizado,
    v_origen.destino_ubicacion_personalizada_id, v_origen.tiempo_estimado_min_horas,
    v_origen.tiempo_estimado_max_horas, v_origen.precio_pallet,
    v_origen.modo_precio_pallet, coalesce(v_origen.modo_umbral_kg, 'desde'),
    v_origen.precio_camion_completo, v_origen.precio_camion_actualizado_at,
    v_origen.apto_peritoneal, v_origen.activo, true, configuracion_origen, v_nombre_copia
  ) returning id into v_nueva_id;

  insert into public.tarifas_bulto (configuracion_id, desde_bulto, precio, es_valor_inicial, updated_at)
    select v_nueva_id, desde_bulto, precio, es_valor_inicial, updated_at from public.tarifas_bulto where configuracion_id = configuracion_origen;
  insert into public.tarifas_pallet (configuracion_id, desde_pallet, precio, updated_at)
    select v_nueva_id, desde_pallet, precio, updated_at from public.tarifas_pallet where configuracion_id = configuracion_origen;
  insert into public.tarifas_kg (configuracion_id, umbral_kg, precio, updated_at)
    select v_nueva_id, umbral_kg, precio, updated_at from public.tarifas_kg where configuracion_id = configuracion_origen;
  insert into public.configuracion_tags (configuracion_id, tag_id)
    select v_nueva_id, tag_id from public.configuracion_tags where configuracion_id = configuracion_origen;
  insert into public.configuracion_tag_precios (configuracion_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo)
    select v_nueva_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo from public.configuracion_tag_precios where configuracion_id = configuracion_origen;

  return v_nueva_id;
end;
$$;
