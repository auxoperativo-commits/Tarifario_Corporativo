-- =========================================================
-- MIGRACIÓN 15: Grupos de Sucursales
--
-- Permite agrupar varias sucursales que operan desde el
-- mismo lugar físico. Una configuración de envío puede
-- tener como origen un grupo (en vez de una sucursal puntual),
-- y cualquier sucursal miembro del grupo resolverá esa
-- configuración al buscar en Envíos.
-- =========================================================

-- ── 1. Tabla maestra de grupos ─────────────────────────────────────────────

create table if not exists grupos_sucursales (
  id         uuid primary key default uuid_generate_v4(),
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nombre)
);

create index if not exists idx_grupos_sucursales_activos
  on grupos_sucursales (nombre) where activo;

alter table grupos_sucursales enable row level security;

create policy "grupos_sucursales_read_authenticated" on grupos_sucursales
  for select using (auth.role() = 'authenticated');

create policy "grupos_sucursales_admin_write" on grupos_sucursales
  for all using (public.es_admin()) with check (public.es_admin());

drop trigger if exists trg_grupos_sucursales_updated_at on grupos_sucursales;
create trigger trg_grupos_sucursales_updated_at
  before update on grupos_sucursales
  for each row execute function set_updated_at();

-- ── 2. Tabla intermedia (miembros) ─────────────────────────────────────────

create table if not exists grupo_sucursales_miembros (
  grupo_id    uuid not null references grupos_sucursales(id) on delete cascade,
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  primary key (grupo_id, sucursal_id)
);

create index if not exists idx_grupo_sucursales_miembros_grupo
  on grupo_sucursales_miembros (grupo_id);
create index if not exists idx_grupo_sucursales_miembros_sucursal
  on grupo_sucursales_miembros (sucursal_id);

alter table grupo_sucursales_miembros enable row level security;

create policy "grupo_miembros_read_authenticated" on grupo_sucursales_miembros
  for select using (auth.role() = 'authenticated');

create policy "grupo_miembros_admin_write" on grupo_sucursales_miembros
  for all using (public.es_admin()) with check (public.es_admin());

-- ── 3. Columna origen_grupo_id en configuraciones_envio ───────────────────

alter table configuraciones_envio
  add column if not exists origen_grupo_id uuid
    references grupos_sucursales(id) on delete set null;

create index if not exists idx_config_origen_grupo
  on configuraciones_envio (origen_grupo_id);

-- CHECK: exactamente uno de (origen_sucursal_id, origen_grupo_id) debe estar
-- cargado para nuevas filas. Las filas existentes con solo origen_sucursal_id
-- ya cumplen la condición. Se usa NOT VALID para no revaluar filas antiguas
-- que puedan tener ambas nulas (configuraciones georef heredadas).
-- Si tu schema garantiza que todas las configs tienen origen_sucursal_id,
-- podés quitar el NOT VALID.
alter table configuraciones_envio
  add constraint chk_origen_exclusivo
  check (
    (origen_sucursal_id is not null and origen_grupo_id is null) or
    (origen_sucursal_id is null     and origen_grupo_id is not null) or
    -- Permitir también origen georef (provincia/localidad) sin sucursal ni grupo
    -- para no romper configs anteriores que no usen sucursal
    (origen_sucursal_id is null     and origen_grupo_id is null)
  ) not valid;

-- ── 4. Actualizar función duplicar_configuracion para copiar origen_grupo_id

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
    modo_precio_pallet, precio_camion_completo, precio_camion_actualizado_at,
    apto_peritoneal, activo, es_copia, configuracion_origen_id, nombre_copia
  ) values (
    v_origen.transporte_id, v_origen.origen_sucursal_id, v_origen.origen_grupo_id,
    v_origen.origen_provincia, v_origen.origen_localidad, v_origen.origen_nombre_personalizado,
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
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tarifas_kg' and column_name = 'umbral_kg'
    ) then
      execute 'insert into public.tarifas_kg (configuracion_id, umbral_kg, precio, updated_at) select $1, umbral_kg, precio, updated_at from public.tarifas_kg where configuracion_id = $2'
        using v_nueva_id, configuracion_origen;
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tarifas_kg' and column_name = 'desde_kg'
    ) then
      execute 'insert into public.tarifas_kg (configuracion_id, desde_kg, precio, updated_at) select $1, desde_kg, precio, updated_at from public.tarifas_kg where configuracion_id = $2'
        using v_nueva_id, configuracion_origen;
    end if;
  end if;
  insert into public.configuracion_tags (configuracion_id, tag_id)
    select v_nueva_id, tag_id from public.configuracion_tags where configuracion_id = configuracion_origen;
  insert into public.configuracion_tag_precios (configuracion_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo)
    select v_nueva_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo from public.configuracion_tag_precios where configuracion_id = configuracion_origen;
  return v_nueva_id;
end;
$$;
