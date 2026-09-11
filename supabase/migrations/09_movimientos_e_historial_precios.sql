-- Auditoria de movimientos e historial de precios.
-- Los triggers registran los cambios desde la base para no depender de una pantalla puntual.

alter table configuraciones_envio
  add column if not exists es_copia boolean not null default false,
  add column if not exists configuracion_origen_id uuid references configuraciones_envio(id) on delete set null,
  add column if not exists nombre_copia text;

create table if not exists movimientos (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid,
  usuario_nombre text not null default 'Usuario',
  tipo text not null,
  transporte_id uuid,
  transporte_nombre text,
  configuracion_id uuid,
  origen_provincia text,
  origen_localidad text,
  destino_provincia text,
  destino_localidad text,
  detalle text,
  created_at timestamptz not null default now()
);

create table if not exists historial_precios (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid,
  usuario_nombre text not null default 'Usuario',
  transporte_id uuid,
  transporte_nombre text,
  configuracion_id uuid,
  origen_provincia text,
  origen_localidad text,
  destino_provincia text,
  destino_localidad text,
  modalidad text not null,
  desde numeric(12,2),
  valor_anterior numeric(12,2),
  valor_nuevo numeric(12,2),
  created_at timestamptz not null default now()
);

create index if not exists idx_movimientos_created_at on movimientos (created_at desc);
create index if not exists idx_movimientos_configuracion on movimientos (configuracion_id, created_at desc);
create index if not exists idx_historial_precios_created_at on historial_precios (created_at desc);
create index if not exists idx_historial_precios_configuracion on historial_precios (configuracion_id, created_at desc);
create index if not exists idx_historial_precios_transporte on historial_precios (transporte_id, created_at desc);

alter table movimientos enable row level security;
alter table historial_precios enable row level security;

drop policy if exists movimientos_read_authenticated on movimientos;
create policy movimientos_read_authenticated on movimientos
  for select using (auth.role() = 'authenticated');
drop policy if exists historial_precios_read_authenticated on historial_precios;
create policy historial_precios_read_authenticated on historial_precios
  for select using (auth.role() = 'authenticated');

create or replace function public.auditoria_usuario_nombre()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif((select nombre_completo from public.perfiles_usuario where id = auth.uid()), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    'Usuario'
  );
$$;

create or replace function public.auditoria_registrar_movimiento(
  p_tipo text,
  p_transporte_id uuid default null,
  p_transporte_nombre text default null,
  p_configuracion_id uuid default null,
  p_origen_provincia text default null,
  p_origen_localidad text default null,
  p_destino_provincia text default null,
  p_destino_localidad text default null,
  p_detalle text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.movimientos (
    usuario_id, usuario_nombre, tipo, transporte_id, transporte_nombre,
    configuracion_id, origen_provincia, origen_localidad, destino_provincia,
    destino_localidad, detalle
  ) values (
    auth.uid(), public.auditoria_usuario_nombre(), p_tipo, p_transporte_id,
    p_transporte_nombre, p_configuracion_id, p_origen_provincia,
    p_origen_localidad, p_destino_provincia, p_destino_localidad, p_detalle
  );
end;
$$;

create or replace function public.auditoria_configuracion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transporte_nombre text;
  v_tipo text;
begin
  if tg_op = 'DELETE' then
    select coalesce(nombre_fantasia, razon_social) into v_transporte_nombre
    from public.transportes where id = old.transporte_id;
  else
    select coalesce(nombre_fantasia, razon_social) into v_transporte_nombre
    from public.transportes where id = new.transporte_id;
  end if;

  if tg_op = 'INSERT' then
    perform public.auditoria_registrar_movimiento(
      case when new.es_copia then 'configuracion_duplicada' else 'configuracion_creada' end,
      new.transporte_id, v_transporte_nombre, new.id, new.origen_provincia,
      new.origen_localidad, new.destino_provincia, new.destino_localidad,
      new.nombre_copia
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.auditoria_registrar_movimiento(
      'configuracion_eliminada', old.transporte_id, v_transporte_nombre, old.id,
      old.origen_provincia, old.origen_localidad, old.destino_provincia, old.destino_localidad
    );
    return old;
  end if;

  if old.activo and not new.activo then
    v_tipo := 'configuracion_dada_de_baja';
  elsif to_jsonb(new) - array['updated_at', 'precio_camion_completo', 'precio_camion_actualizado_at']
        is distinct from to_jsonb(old) - array['updated_at', 'precio_camion_completo', 'precio_camion_actualizado_at'] then
    v_tipo := 'configuracion_editada';
  end if;

  if v_tipo is not null then
    perform public.auditoria_registrar_movimiento(
      v_tipo, new.transporte_id, v_transporte_nombre, new.id,
      new.origen_provincia, new.origen_localidad, new.destino_provincia, new.destino_localidad
    );
  end if;
  return new;
end;
$$;

create or replace function public.auditoria_transporte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_tipo text;
begin
  if tg_op = 'INSERT' then
    perform public.auditoria_registrar_movimiento('transporte_creado', new.id, coalesce(new.nombre_fantasia, new.razon_social));
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.auditoria_registrar_movimiento('transporte_eliminado', old.id, coalesce(old.nombre_fantasia, old.razon_social));
    return old;
  end if;
  v_tipo := case when old.activo and not new.activo then 'transporte_dado_de_baja' else 'transporte_editado' end;
  perform public.auditoria_registrar_movimiento(v_tipo, new.id, coalesce(new.nombre_fantasia, new.razon_social));
  return new;
end;
$$;

create or replace function public.auditoria_precio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuracion_id uuid;
  v_anterior numeric;
  v_nuevo numeric;
  v_desde numeric;
  v_modalidad text;
  v_config record;
  v_transporte_nombre text;
begin
  if tg_table_name = 'configuraciones_envio' then
    if new.precio_camion_completo is not distinct from old.precio_camion_completo then return new; end if;
    v_configuracion_id := new.id; v_anterior := old.precio_camion_completo;
    v_nuevo := new.precio_camion_completo; v_desde := null; v_modalidad := 'Camion completo';
  elsif tg_table_name = 'tarifas_bulto' then
    if new.precio is not distinct from old.precio then return new; end if;
    v_configuracion_id := new.configuracion_id; v_anterior := old.precio;
    v_nuevo := new.precio; v_desde := new.desde_bulto; v_modalidad := 'Bulto';
  elsif tg_table_name = 'tarifas_pallet' then
    if new.precio is not distinct from old.precio then return new; end if;
    v_configuracion_id := new.configuracion_id; v_anterior := old.precio;
    v_nuevo := new.precio; v_desde := new.desde_pallet; v_modalidad := 'Pallet';
  else
    if new.precio is not distinct from old.precio then return new; end if;
    v_configuracion_id := new.configuracion_id; v_anterior := old.precio;
    v_nuevo := new.precio; v_desde := new.desde_kg; v_modalidad := 'Kg';
  end if;

  select * into v_config from public.configuraciones_envio where id = v_configuracion_id;
  if not found then return new; end if;
  select coalesce(nombre_fantasia, razon_social) into v_transporte_nombre
  from public.transportes where id = v_config.transporte_id;

  insert into public.historial_precios (
    usuario_id, usuario_nombre, transporte_id, transporte_nombre, configuracion_id,
    origen_provincia, origen_localidad, destino_provincia, destino_localidad,
    modalidad, desde, valor_anterior, valor_nuevo
  ) values (
    auth.uid(), public.auditoria_usuario_nombre(), v_config.transporte_id,
    v_transporte_nombre, v_configuracion_id, v_config.origen_provincia,
    v_config.origen_localidad, v_config.destino_provincia, v_config.destino_localidad,
    v_modalidad, v_desde, v_anterior, v_nuevo
  );
  perform public.auditoria_registrar_movimiento(
    'precio_actualizado', v_config.transporte_id, v_transporte_nombre,
    v_configuracion_id, v_config.origen_provincia, v_config.origen_localidad,
    v_config.destino_provincia, v_config.destino_localidad, 'Precio de ' || lower(v_modalidad)
  );
  return new;
end;
$$;

drop trigger if exists trg_auditoria_configuracion on configuraciones_envio;
create trigger trg_auditoria_configuracion after insert or update or delete on configuraciones_envio
  for each row execute function public.auditoria_configuracion();
drop trigger if exists trg_auditoria_transporte on transportes;
create trigger trg_auditoria_transporte after insert or update or delete on transportes
  for each row execute function public.auditoria_transporte();
drop trigger if exists trg_auditoria_precio_camion on configuraciones_envio;
create trigger trg_auditoria_precio_camion after update on configuraciones_envio
  for each row execute function public.auditoria_precio();
drop trigger if exists trg_auditoria_precio_bulto on tarifas_bulto;
create trigger trg_auditoria_precio_bulto after update on tarifas_bulto
  for each row execute function public.auditoria_precio();
drop trigger if exists trg_auditoria_precio_pallet on tarifas_pallet;
create trigger trg_auditoria_precio_pallet after update on tarifas_pallet
  for each row execute function public.auditoria_precio();

do $$
begin
  if to_regclass('public.tarifas_kg') is not null then
    execute 'drop trigger if exists trg_auditoria_precio_kg on public.tarifas_kg';
    execute 'create trigger trg_auditoria_precio_kg after update on public.tarifas_kg for each row execute function public.auditoria_precio()';
  end if;
end;
$$;

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
    select count(*) + 1 from public.configuraciones_envio
    where configuracion_origen_id = configuracion_origen
  );
  insert into public.configuraciones_envio (
    transporte_id, origen_provincia, origen_localidad, origen_nombre_personalizado,
    origen_ubicacion_personalizada_id, destino_provincia, destino_localidad,
    destino_nombre_personalizado, destino_ubicacion_personalizada_id,
    tiempo_estimado_min_horas, tiempo_estimado_max_horas, precio_pallet,
    precio_camion_completo, precio_camion_actualizado_at, apto_peritoneal, activo,
    es_copia, configuracion_origen_id, nombre_copia
  ) values (
    v_origen.transporte_id, v_origen.origen_provincia, v_origen.origen_localidad,
    v_origen.origen_nombre_personalizado, v_origen.origen_ubicacion_personalizada_id,
    v_origen.destino_provincia, v_origen.destino_localidad,
    v_origen.destino_nombre_personalizado, v_origen.destino_ubicacion_personalizada_id,
    v_origen.tiempo_estimado_min_horas, v_origen.tiempo_estimado_max_horas,
    v_origen.precio_pallet, v_origen.precio_camion_completo,
    v_origen.precio_camion_actualizado_at, v_origen.apto_peritoneal, v_origen.activo,
    true, configuracion_origen, v_nombre_copia
  ) returning id into v_nueva_id;

  insert into public.tarifas_bulto (configuracion_id, desde_bulto, precio, es_valor_inicial, updated_at)
    select v_nueva_id, desde_bulto, precio, es_valor_inicial, updated_at
    from public.tarifas_bulto where configuracion_id = configuracion_origen;
  insert into public.tarifas_pallet (configuracion_id, desde_pallet, precio, updated_at)
    select v_nueva_id, desde_pallet, precio, updated_at
    from public.tarifas_pallet where configuracion_id = configuracion_origen;
  if to_regclass('public.tarifas_kg') is not null then
    execute 'insert into public.tarifas_kg (configuracion_id, desde_kg, precio, updated_at)
      select $1, desde_kg, precio, updated_at from public.tarifas_kg where configuracion_id = $2'
      using v_nueva_id, configuracion_origen;
  end if;
  insert into public.configuracion_tags (configuracion_id, tag_id)
    select v_nueva_id, tag_id from public.configuracion_tags where configuracion_id = configuracion_origen;
  insert into public.configuracion_tag_precios (
    configuracion_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo
  ) select v_nueva_id, tag_id, precio_bulto, precio_pallet, precio_kg, precio_camion_completo
    from public.configuracion_tag_precios where configuracion_id = configuracion_origen;
  return v_nueva_id;
end;
$$;
