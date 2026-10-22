-- Conserva el historial de precios aunque se elimine la configuración.
-- El detalle sigue guardando tabla, registro, concepto y valores antes/después;
-- solo pierde el vínculo con la configuración que ya no existe.
alter table public.actualizaciones_precio_detalle
  alter column configuracion_id drop not null;

alter table public.actualizaciones_precio_detalle
  drop constraint if exists actualizaciones_precio_detalle_configuracion_id_fkey;

alter table public.actualizaciones_precio_detalle
  add constraint actualizaciones_precio_detalle_configuracion_id_fkey
  foreign key (configuracion_id)
  references public.configuraciones_envio(id)
  on delete set null;

-- Una actualización que incluye precios de una configuración eliminada no se
-- puede revertir íntegramente: los registros de precio asociados ya no existen.
-- Informar ese caso como conflicto antes de tocar cualquier precio.
create or replace function public.revertir_actualizacion_precios(p_actualizacion_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_conflictos jsonb := '[]'::jsonb;
  v_detalle record;
  v_count integer;
  v_precio_actual numeric;
begin
  if auth.uid() is null or not public.es_admin() then
    raise exception 'Permiso denegado: solo administradores pueden revertir actualizaciones.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.actualizaciones_precio where id = p_actualizacion_id and revertida_at is null) then
    raise exception 'La actualización no existe o ya fue revertida.' using errcode = '22023';
  end if;

  for v_detalle in
    select d.*, c.columna_fecha_actualizacion
    from public.actualizaciones_precio_detalle d
    join public.catalogo_campos_precio c on c.tabla = d.tabla and c.columna_precio = d.columna_precio
    where d.actualizacion_id = p_actualizacion_id
  loop
    if v_detalle.configuracion_id is null then
      v_conflictos := v_conflictos || jsonb_build_array(jsonb_build_object(
        'tabla', v_detalle.tabla, 'registro_id', v_detalle.registro_id,
        'columna_precio', v_detalle.columna_precio,
        'configuracion_eliminada', true,
        'mensaje', 'La configuración asociada fue eliminada; este precio ya no se puede restaurar.'
      ));
      continue;
    end if;

    execute format('select %I from public.%I where id = $1', v_detalle.columna_precio, v_detalle.tabla)
      into v_precio_actual using v_detalle.registro_id;
    if v_precio_actual is distinct from v_detalle.precio_nuevo then
      v_conflictos := v_conflictos || jsonb_build_array(jsonb_build_object(
        'tabla', v_detalle.tabla, 'registro_id', v_detalle.registro_id,
        'columna_precio', v_detalle.columna_precio, 'precio_esperado', v_detalle.precio_nuevo,
        'precio_actual', v_precio_actual));
    end if;
  end loop;

  if jsonb_array_length(v_conflictos) > 0 then
    return jsonb_build_object('ok', false, 'conflictos', v_conflictos);
  end if;

  for v_detalle in
    select d.*, c.columna_fecha_actualizacion
    from public.actualizaciones_precio_detalle d
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
