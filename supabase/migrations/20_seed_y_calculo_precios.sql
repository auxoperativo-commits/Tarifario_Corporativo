-- Reafirma las filas del catálogo (también repara instalaciones donde el seed 19 no se ejecutó)
-- y expone una única fórmula SQL usada por preview y commit.
insert into public.catalogo_campos_precio
  (concepto, etiqueta, tabla, columna_precio, columna_configuracion_id, columna_fecha_actualizacion, activo)
values
  ('bultos', 'Bultos', 'tarifas_bulto', 'precio', 'configuracion_id', 'updated_at', true),
  ('pallets', 'Pallets', 'tarifas_pallet', 'precio', 'configuracion_id', 'updated_at', true),
  ('pallets', 'Pallets (precio fijo)', 'configuraciones_envio', 'precio_pallet', 'id', 'updated_at', true),
  ('kg', 'Kg', 'tarifas_kg', 'precio', 'configuracion_id', 'updated_at', true),
  ('camion_completo', 'Camión completo', 'configuraciones_envio', 'precio_camion_completo', 'id', 'precio_camion_actualizado_at', true),
  ('servicios', 'Servicios de transporte', 'configuracion_servicios', 'valor', 'configuracion_id', 'updated_at', true),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_bulto', 'configuracion_id', 'updated_at', true),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_pallet', 'configuracion_id', 'updated_at', true),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_kg', 'configuracion_id', 'updated_at', true),
  ('tags', 'Tags con valor', 'configuracion_tag_precios', 'precio_camion_completo', 'configuracion_id', 'updated_at', true)
on conflict (tabla, columna_precio) do update set activo = true;

drop policy if exists catalogo_precio_admin on public.catalogo_campos_precio;
create policy catalogo_precio_admin on public.catalogo_campos_precio
  for all using (public.es_admin()) with check (public.es_admin());

create or replace function public.calcular_nuevo_precio(
  p_precio_anterior numeric, p_tipo_ajuste text, p_valor numeric, p_redondeo integer
)
returns numeric
language plpgsql immutable set search_path = public
as $$
declare v_nuevo numeric;
begin
  if p_precio_anterior is null or p_tipo_ajuste is null or p_tipo_ajuste not in ('porcentaje', 'monto_fijo')
    or p_valor is null or p_redondeo is null or p_redondeo not in (0, 1, 10, 100, 1000) then
    raise exception 'Parámetros de cálculo inválidos.' using errcode = '22023';
  end if;
  if p_tipo_ajuste = 'porcentaje' then
    v_nuevo := p_precio_anterior * (1 + p_valor / 100);
  else
    v_nuevo := p_precio_anterior + p_valor;
  end if;
  if p_redondeo > 0 then v_nuevo := round(v_nuevo / p_redondeo) * p_redondeo; end if;
  return round(v_nuevo, 2);
end;
$$;

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
declare v_campo record;
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
        public.calcular_nuevo_precio(p.%2$I::numeric, $5, $6, $7),
        public.calcular_nuevo_precio(p.%2$I::numeric, $5, $6, $7) - p.%2$I::numeric,
        case when p.%2$I::numeric = 0 then null else
          (public.calcular_nuevo_precio(p.%2$I::numeric, $5, $6, $7) / p.%2$I::numeric - 1) * 100 end
       from public.%3$I p join public.configuraciones_envio ce on ce.id = p.%1$I
       where p.%1$I = any($8) and ($9 or ce.activo) and p.%2$I is not null',
      v_campo.columna_configuracion_id, v_campo.columna_precio, v_campo.tabla
    ) using v_campo.concepto, v_campo.etiqueta, v_campo.tabla, v_campo.columna_precio,
      p_tipo_ajuste, p_valor, p_redondeo, p_configuracion_ids, p_incluir_inactivas;
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
  select coalesce(jsonb_agg(to_jsonb(y)), '[]'::jsonb) into v_rows
  from (
    select a.concepto, a.etiqueta, a.tabla, a.columna_precio, a.registro_id, a.configuracion_id,
      a.precio_anterior, a.precio_nuevo,
      abs(round(a.precio_nuevo - a.precio_anterior, 2)) as diferencia,
      case when a.precio_anterior = 0 then null else round((a.precio_nuevo / a.precio_anterior - 1) * 100, 2) end as variacion_porcentual
    from public.calcular_actualizacion_precios(p_configuracion_ids, p_tipo_ajuste, p_valor, p_redondeo, p_conceptos, p_incluir_inactivas) a
    where a.precio_nuevo is distinct from a.precio_anterior
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

revoke all on function public.calcular_nuevo_precio(numeric, text, numeric, integer) from public;
grant execute on function public.calcular_nuevo_precio(numeric, text, numeric, integer) to anon, authenticated;
