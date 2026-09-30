-- =========================================================
-- LIMPIEZA DEFINITIVA PARA KG
-- Elimina referencias viejas a desde_kg y deja la base en modo canonico con umbral_kg.
-- Seguro para correr aunque la tabla ya tenga solo una de las dos columnas.
-- =========================================================

-- 0) Ver qué existe en la base antes de tocarla
select table_schema, table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('tarifas_kg', 'configuraciones_envio')
order by table_name, ordinal_position;

-- 1) Normalizar la columna de kg
alter table public.tarifas_kg add column if not exists umbral_kg numeric;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tarifas_kg'
      and column_name = 'desde_kg'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tarifas_kg'
      and column_name = 'umbral_kg'
  ) then
    alter table public.tarifas_kg rename column desde_kg to umbral_kg;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tarifas_kg'
      and column_name = 'umbral_kg'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tarifas_kg'
      and column_name = 'desde_kg'
  ) then
    update public.tarifas_kg
    set umbral_kg = coalesce(umbral_kg, desde_kg)
    where umbral_kg is null and desde_kg is not null;
  end if;
end $$;

-- 2) Eliminar columna legacy si aún quedó
alter table public.tarifas_kg drop column if exists desde_kg;

-- 3) Reforzar constraint canonica de kg
alter table public.tarifas_kg
  alter column umbral_kg set not null;

create unique index if not exists tarifas_kg_configuracion_id_umbral_kg_key
  on public.tarifas_kg (configuracion_id, umbral_kg);

-- 4) Quitar triggers dependientes antes de reemplazar la funcion
--    para evitar el error "cannot drop function ... because other objects depend on it"
drop trigger if exists trg_auditoria_precio_camion on public.configuraciones_envio;
drop trigger if exists trg_auditoria_precio_bulto on public.tarifas_bulto;
drop trigger if exists trg_auditoria_precio_pallet on public.tarifas_pallet;
drop trigger if exists trg_auditoria_precio_kg on public.tarifas_kg;

drop function if exists public.auditoria_precio();

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
    if new.precio_camion_completo is not distinct from old.precio_camion_completo then
      return new;
    end if;
    v_configuracion_id := new.id;
    v_anterior := old.precio_camion_completo;
    v_nuevo := new.precio_camion_completo;
    v_desde := null;
    v_modalidad := 'Camion completo';
  elsif tg_table_name = 'tarifas_bulto' then
    if new.precio is not distinct from old.precio then
      return new;
    end if;
    v_configuracion_id := new.configuracion_id;
    v_anterior := old.precio;
    v_nuevo := new.precio;
    v_desde := new.desde_bulto;
    v_modalidad := 'Bulto';
  elsif tg_table_name = 'tarifas_pallet' then
    if new.precio is not distinct from old.precio then
      return new;
    end if;
    v_configuracion_id := new.configuracion_id;
    v_anterior := old.precio;
    v_nuevo := new.precio;
    v_desde := new.desde_pallet;
    v_modalidad := 'Pallet';
  elsif tg_table_name = 'tarifas_kg' then
    if new.precio is not distinct from old.precio then
      return new;
    end if;
    v_configuracion_id := new.configuracion_id;
    v_anterior := old.precio;
    v_nuevo := new.precio;
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tarifas_kg'
        and column_name = 'umbral_kg'
    ) then
      v_desde := new.umbral_kg;
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tarifas_kg'
        and column_name = 'desde_kg'
    ) then
      execute 'select $1.desde_kg' into v_desde using new;
    else
      v_desde := 0;
    end if;
    v_modalidad := 'Kg';
  else
    return new;
  end if;

  select * into v_config
  from public.configuraciones_envio
  where id = v_configuracion_id;

  if not found then
    return new;
  end if;

  select coalesce(nombre_fantasia, razon_social)
    into v_transporte_nombre
  from public.transportes
  where id = v_config.transporte_id;

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
    v_config.destino_provincia, v_config.destino_localidad,
    'Precio de ' || lower(v_modalidad)
  );

  return new;
end;
$$;

drop trigger if exists trg_auditoria_precio_camion on public.configuraciones_envio;
create trigger trg_auditoria_precio_camion after update on public.configuraciones_envio
for each row
execute function public.auditoria_precio();

drop trigger if exists trg_auditoria_precio_bulto on public.tarifas_bulto;
create trigger trg_auditoria_precio_bulto after update on public.tarifas_bulto
for each row
execute function public.auditoria_precio();

drop trigger if exists trg_auditoria_precio_pallet on public.tarifas_pallet;
create trigger trg_auditoria_precio_pallet after update on public.tarifas_pallet
for each row
execute function public.auditoria_precio();

drop trigger if exists trg_auditoria_precio_kg on public.tarifas_kg;
create trigger trg_auditoria_precio_kg after update on public.tarifas_kg
for each row
execute function public.auditoria_precio();

-- 5) Verificación final
select 'OK: columna canonical', column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tarifas_kg'
  and column_name = 'umbral_kg';

select tgname
from pg_trigger
where tgrelid = 'public.tarifas_kg'::regclass;
