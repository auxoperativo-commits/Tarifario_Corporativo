-- Actualización masiva de precios, historial y reversión administrada.

create table if not exists public.catalogo_campos_precio (
  id uuid primary key default gen_random_uuid(),
  concepto text not null,
  etiqueta text not null,
  tabla text not null,
  columna_precio text not null,
  columna_configuracion_id text not null,
  columna_fecha_actualizacion text,
  activo boolean not null default true,
  unique (tabla, columna_precio)
);

insert into public.catalogo_campos_precio
  (concepto, etiqueta, tabla, columna_precio, columna_configuracion_id, columna_fecha_actualizacion)
values
  ('bultos', 'Bultos', 'tarifas_bulto', 'precio', 'configuracion_id', 'updated_at'),
  ('pallets', 'Pallets', 'tarifas_pallet', 'precio', 'configuracion_id', 'updated_at'),
  ('pallets', 'Pallets (precio fijo)', 'configuraciones_envio', 'precio_pallet', 'id', 'updated_at'),
  ('kg', 'Kg', 'tarifas_kg', 'precio', 'configuracion_id', 'updated_at'),
  ('camion_completo', 'Camión completo', 'configuraciones_envio', 'precio_camion_completo', 'id', 'precio_camion_actualizado_at'),
  ('servicios', 'Servicios de transporte', 'configuracion_servicios', 'valor', 'configuracion_id', 'updated_at'),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_bulto', 'configuracion_id', 'updated_at'),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_pallet', 'configuracion_id', 'updated_at'),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_kg', 'configuracion_id', 'updated_at'),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_camion_completo', 'configuracion_id', 'updated_at')
on conflict (tabla, columna_precio) do nothing;

create table if not exists public.actualizaciones_precio (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles_usuario(id),
  tipo_ajuste text not null check (tipo_ajuste in ('porcentaje', 'monto_fijo')),
  valor numeric not null,
  redondeo integer not null check (redondeo in (0, 1, 10, 100, 1000)),
  conceptos text[] not null,
  nota text,
  cantidad_configuraciones integer not null default 0,
  cantidad_precios_modificados integer not null default 0,
  created_at timestamptz not null default now(),
  revertida_at timestamptz,
  revertida_por uuid references public.perfiles_usuario(id)
);

create table if not exists public.actualizaciones_precio_detalle (
  id uuid primary key default gen_random_uuid(),
  actualizacion_id uuid not null references public.actualizaciones_precio(id) on delete cascade,
  concepto text not null,
  tabla text not null,
  registro_id uuid not null,
  configuracion_id uuid not null references public.configuraciones_envio(id),
  precio_anterior numeric not null,
  precio_nuevo numeric not null,
  columna_precio text not null
);

create index if not exists idx_actualizaciones_precio_detalle_actualizacion
  on public.actualizaciones_precio_detalle (actualizacion_id);
create index if not exists idx_actualizaciones_precio_detalle_registro
  on public.actualizaciones_precio_detalle (registro_id);

alter table public.catalogo_campos_precio enable row level security;
alter table public.actualizaciones_precio enable row level security;
alter table public.actualizaciones_precio_detalle enable row level security;

drop policy if exists catalogo_precio_admin on public.catalogo_campos_precio;
create policy catalogo_precio_admin on public.catalogo_campos_precio
  for all using (public.es_admin()) with check (public.es_admin());
drop policy if exists actualizaciones_precio_admin on public.actualizaciones_precio;
create policy actualizaciones_precio_admin on public.actualizaciones_precio
  for all using (public.es_admin()) with check (public.es_admin());
drop policy if exists actualizaciones_precio_detalle_admin on public.actualizaciones_precio_detalle;
create policy actualizaciones_precio_detalle_admin on public.actualizaciones_precio_detalle
  for all using (public.es_admin()) with check (public.es_admin());

grant select, insert, update, delete on public.catalogo_campos_precio to authenticated;
grant select, insert, update, delete on public.actualizaciones_precio to authenticated;
grant select, insert, update, delete on public.actualizaciones_precio_detalle to authenticated;

create or replace function public.calcular_actualizacion_precios(
  p_configuracion_ids uuid[], p_tipo_ajuste text, p_valor numeric,
  p_redondeo integer, p_conceptos text[], p_incluir_inactivas boolean default false
)
returns table (
  concepto text, etiqueta text, tabla text, columna_precio text,
  registro_id uuid, configuracion_id uuid, precio_anterior numeric,
  precio_nuevo numeric, diferencia numeric, variacion_porcentual numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_campo record;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Permiso denegado: solo administradores pueden actualizar precios.' using errcode = '42501';
  end if;
  if p_tipo_ajuste is null or p_tipo_ajuste not in ('porcentaje', 'monto_fijo')
    or p_redondeo is null or p_redondeo not in (0, 1, 10, 100, 1000)
    or p_valor is null or p_valor = 0 or coalesce(array_length(p_conceptos, 1), 0) = 0
    or coalesce(cardinality(p_configuracion_ids), 0) = 0 then
    raise exception 'Parámetros de actualización inválidos.' using errcode = '22023';
  end if;

  for v_campo in
    select c.* from public.catalogo_campos_precio c
    where c.activo and c.concepto = any(p_conceptos)
  loop
    return query execute format(
      'select $1, $2, $3, $4, p.id, p.%1$I, p.%2$I::numeric,
        (case when $5 = ''porcentaje'' then p.%2$I::numeric * (1 + $6 / 100) else p.%2$I::numeric + $6 end),
        ((case when $5 = ''porcentaje'' then p.%2$I::numeric * (1 + $6 / 100) else p.%2$I::numeric + $6 end) - p.%2$I::numeric),
        case when p.%2$I::numeric = 0 then null else (((case when $5 = ''porcentaje'' then p.%2$I::numeric * (1 + $6 / 100) else p.%2$I::numeric + $6 end) / p.%2$I::numeric) - 1) * 100 end
       from public.%3$I p join public.configuraciones_envio ce on ce.id = p.%1$I
       where p.%1$I = any($7) and ($8 or ce.activo) and p.%2$I is not null',
      v_campo.columna_configuracion_id, v_campo.columna_precio, v_campo.tabla
    ) using v_campo.concepto, v_campo.etiqueta, v_campo.tabla, v_campo.columna_precio,
      p_tipo_ajuste, p_valor, p_configuracion_ids, p_incluir_inactivas;
  end loop;
end;
$$;

create or replace function public.previsualizar_actualizacion_precios(
  p_configuracion_ids uuid[], p_tipo_ajuste text, p_valor numeric,
  p_redondeo integer, p_conceptos text[], p_incluir_inactivas boolean default false
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Permiso denegado: solo administradores pueden previsualizar actualizaciones.' using errcode = '42501';
  end if;
  -- El redondeo elegido se aplica después de la fórmula, a múltiplos y al centavo del campo numeric(12,2).
  select coalesce(jsonb_agg(to_jsonb(y)), '[]'::jsonb) into v_rows
  from (
    select a.concepto, a.etiqueta, a.tabla, a.columna_precio, a.registro_id, a.configuracion_id,
      a.precio_anterior,
      round(case when p_redondeo = 0 then a.precio_nuevo
        else round(a.precio_nuevo / p_redondeo) * p_redondeo end, 2) as precio_nuevo,
      abs(round((case when p_redondeo = 0 then a.precio_nuevo
        else round(a.precio_nuevo / p_redondeo) * p_redondeo end) - a.precio_anterior, 2)) as diferencia,
      case when a.precio_anterior = 0 then null else round((((case when p_redondeo = 0 then a.precio_nuevo
        else round(a.precio_nuevo / p_redondeo) * p_redondeo end) / a.precio_anterior) - 1) * 100, 2) end as variacion_porcentual
    from public.calcular_actualizacion_precios(p_configuracion_ids, p_tipo_ajuste, p_valor, 0, p_conceptos, p_incluir_inactivas) a
    where round(case when p_redondeo = 0 then a.precio_nuevo
      else round(a.precio_nuevo / p_redondeo) * p_redondeo end, 2) is distinct from a.precio_anterior
  ) y;
  return jsonb_build_object('items', v_rows,
    'cantidad_configuraciones', (select count(distinct (e->>'configuracion_id')) from jsonb_array_elements(v_rows) e),
    'cantidad_precios', jsonb_array_length(v_rows),
    'bloqueantes', (select count(*) from jsonb_array_elements(v_rows) e where (e->>'precio_nuevo')::numeric <= 0),
    'advertencias', (select count(*) from jsonb_array_elements(v_rows) e where
      abs(coalesce((e->>'variacion_porcentual')::numeric, 0)) > 50
      or ((e->>'precio_anterior')::numeric = 0 and (e->>'precio_nuevo')::numeric <> 0)));
end;
$$;

create or replace function public.aplicar_actualizacion_precios(
  p_configuracion_ids uuid[], p_tipo_ajuste text, p_valor numeric,
  p_redondeo integer, p_conceptos text[], p_nota text default null,
  p_incluir_inactivas boolean default false
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_preview jsonb; v_id uuid; v_item jsonb; v_rows jsonb; v_count integer := 0; v_fecha text;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Permiso denegado: solo administradores pueden aplicar actualizaciones.' using errcode = '42501';
  end if;
  v_preview := public.previsualizar_actualizacion_precios(p_configuracion_ids, p_tipo_ajuste, p_valor, p_redondeo, p_conceptos, p_incluir_inactivas);
  if (v_preview->>'bloqueantes')::integer > 0 then
    raise exception 'La actualización produciría precios cero o negativos.' using errcode = '22023';
  end if;
  v_rows := v_preview->'items';
  if jsonb_array_length(v_rows) = 0 then raise exception 'No hay precios para modificar.' using errcode = '22023'; end if;

  insert into public.actualizaciones_precio
    (usuario_id, tipo_ajuste, valor, redondeo, conceptos, nota, cantidad_configuraciones, cantidad_precios_modificados)
  values (auth.uid(), p_tipo_ajuste, p_valor, p_redondeo, p_conceptos, nullif(trim(p_nota), ''),
    (v_preview->>'cantidad_configuraciones')::integer, jsonb_array_length(v_rows))
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(v_rows)
  loop
    select columna_fecha_actualizacion into v_fecha from public.catalogo_campos_precio
      where tabla = v_item->>'tabla' and columna_precio = v_item->>'columna_precio';
    if v_fecha is null then
      execute format('update public.%I set %I = $1 where id = $2 and %I is not distinct from $3',
        v_item->>'tabla', v_item->>'columna_precio', v_item->>'columna_precio')
      using (v_item->>'precio_nuevo')::numeric, (v_item->>'registro_id')::uuid, (v_item->>'precio_anterior')::numeric;
    else
      execute format('update public.%I set %I = $1, %I = now() where id = $2 and %I is not distinct from $3',
        v_item->>'tabla', v_item->>'columna_precio', v_fecha, v_item->>'columna_precio')
      using (v_item->>'precio_nuevo')::numeric, (v_item->>'registro_id')::uuid, (v_item->>'precio_anterior')::numeric;
    end if;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'El precio cambió durante la operación; no se aplicó ningún cambio.' using errcode = '40001'; end if;
    insert into public.actualizaciones_precio_detalle
      (actualizacion_id, concepto, tabla, registro_id, configuracion_id, precio_anterior, precio_nuevo, columna_precio)
    values (v_id, v_item->>'concepto', v_item->>'tabla', (v_item->>'registro_id')::uuid,
      (v_item->>'configuracion_id')::uuid, (v_item->>'precio_anterior')::numeric, (v_item->>'precio_nuevo')::numeric, v_item->>'columna_precio');
  end loop;
  update public.configuraciones_envio set updated_at = now()
  where id = any(array(select distinct (e->>'configuracion_id')::uuid from jsonb_array_elements(v_rows) e));
  return jsonb_build_object('id', v_id, 'cantidad_configuraciones', (v_preview->>'cantidad_configuraciones')::integer,
    'cantidad_precios', jsonb_array_length(v_rows));
end;
$$;

create or replace function public.revertir_actualizacion_precios(p_actualizacion_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_conflictos jsonb := '[]'::jsonb; v_detalle record; v_count integer; v_precio_actual numeric;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Permiso denegado: solo administradores pueden revertir actualizaciones.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.actualizaciones_precio where id = p_actualizacion_id and revertida_at is null) then
    raise exception 'La actualización no existe o ya fue revertida.' using errcode = '22023';
  end if;
  -- Las columnas provienen del catálogo y se interpolan como identificadores citados.
  for v_detalle in select d.*, c.columna_fecha_actualizacion from public.actualizaciones_precio_detalle d
    join public.catalogo_campos_precio c on c.tabla = d.tabla and c.columna_precio = d.columna_precio
    where d.actualizacion_id = p_actualizacion_id
  loop
    execute format('select %I from public.%I where id = $1', v_detalle.columna_precio, v_detalle.tabla)
      into v_precio_actual using v_detalle.registro_id;
    if v_precio_actual is distinct from v_detalle.precio_nuevo then
      v_conflictos := coalesce(v_conflictos, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'tabla', v_detalle.tabla, 'registro_id', v_detalle.registro_id,
        'columna_precio', v_detalle.columna_precio, 'precio_esperado', v_detalle.precio_nuevo,
        'precio_actual', v_precio_actual));
    end if;
  end loop;
  if jsonb_array_length(coalesce(v_conflictos, '[]'::jsonb)) > 0 then
    return jsonb_build_object('ok', false, 'conflictos', v_conflictos);
  end if;
  for v_detalle in select d.*, c.columna_fecha_actualizacion from public.actualizaciones_precio_detalle d
    join public.catalogo_campos_precio c on c.tabla = d.tabla and c.columna_precio = d.columna_precio
    where d.actualizacion_id = p_actualizacion_id
  loop
    if v_detalle.columna_fecha_actualizacion is null then
      execute format('update public.%I set %I = $1 where id = $2 and %I is not distinct from $3',
        v_detalle.tabla, v_detalle.columna_precio, v_detalle.columna_precio)
        using v_detalle.precio_anterior, v_detalle.registro_id, v_detalle.precio_nuevo;
    else
      execute format('update public.%I set %I = $1, %I = now() where id = $2 and %I is not distinct from $3',
        v_detalle.tabla, v_detalle.columna_precio, v_detalle.columna_fecha_actualizacion, v_detalle.columna_precio)
        using v_detalle.precio_anterior, v_detalle.registro_id, v_detalle.precio_nuevo;
    end if;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'Conflicto al revertir; no se aplicó ningún cambio.' using errcode = '40001'; end if;
  end loop;
  update public.configuraciones_envio ce set updated_at = now()
  where ce.id in (select distinct configuracion_id from public.actualizaciones_precio_detalle where actualizacion_id = p_actualizacion_id);
  update public.actualizaciones_precio set revertida_at = now(), revertida_por = auth.uid() where id = p_actualizacion_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.calcular_actualizacion_precios(uuid[], text, numeric, integer, text[], boolean) from public;
revoke all on function public.previsualizar_actualizacion_precios(uuid[], text, numeric, integer, text[], boolean) from public;
revoke all on function public.aplicar_actualizacion_precios(uuid[], text, numeric, integer, text[], text, boolean) from public;
revoke all on function public.revertir_actualizacion_precios(uuid) from public;
grant execute on function public.calcular_actualizacion_precios(uuid[], text, numeric, integer, text[], boolean) to authenticated;
grant execute on function public.previsualizar_actualizacion_precios(uuid[], text, numeric, integer, text[], boolean) to authenticated;
grant execute on function public.aplicar_actualizacion_precios(uuid[], text, numeric, integer, text[], text, boolean) to authenticated;
grant execute on function public.revertir_actualizacion_precios(uuid) to authenticated;
