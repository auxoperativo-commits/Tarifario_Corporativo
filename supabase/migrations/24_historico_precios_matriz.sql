-- Une el histórico individual (triggers) con el historial de ajustes masivos.
-- Es aditiva: conserva registros, tablas y políticas existentes.
alter table public.historial_precios
  add column if not exists registro_precio_id uuid,
  add column if not exists concepto text,
  add column if not exists etiqueta text,
  add column if not exists columna_precio text,
  add column if not exists evento_tipo text not null default 'manual',
  add column if not exists configuracion_id_original uuid;

alter table public.actualizaciones_precio_detalle
  add column if not exists transporte_id uuid,
  add column if not exists transporte_nombre text,
  add column if not exists origen_etiqueta text,
  add column if not exists destino_etiqueta text,
  add column if not exists configuracion_activa boolean,
  add column if not exists configuracion_id_original uuid,
  add column if not exists etiqueta text;

create index if not exists idx_historial_precios_fecha_registro
  on public.historial_precios (created_at, registro_precio_id);
create index if not exists idx_historial_precios_registro_fecha
  on public.historial_precios (registro_precio_id, created_at desc);
create index if not exists idx_historial_precios_transporte_fecha
  on public.historial_precios (transporte_id, created_at desc);
create index if not exists idx_actualizaciones_precio_detalle_config_registro
  on public.actualizaciones_precio_detalle (configuracion_id, registro_id);
create index if not exists idx_actualizaciones_precio_detalle_transporte_registro
  on public.actualizaciones_precio_detalle (transporte_id, registro_id, actualizacion_id);
create index if not exists idx_actualizaciones_precio_created_at
  on public.actualizaciones_precio (created_at desc);

-- Captura la identidad del precio en los cambios manuales. La identidad se
-- mantiene aunque cambie la etiqueta visible del tramo.
create or replace function public.auditoria_precio_matriz()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_config_id uuid; v_config public.configuraciones_envio%rowtype;
  v_before numeric; v_after numeric; v_threshold numeric; v_transport_name text; v_label text;
begin
  if current_setting('app.precio_masivo_sin_trigger',true)='true' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
  if tg_op='UPDATE' and v_old->>tg_argv[1] is not distinct from v_new->>tg_argv[1] then return new; end if;
  v_row := coalesce(v_new,v_old);
  v_config_id := (v_row->>tg_argv[2])::uuid;
  if tg_table_name='configuraciones_envio' then v_config_id := (v_row->>'id')::uuid; end if;
  select * into v_config from public.configuraciones_envio where id=v_config_id;
  if not found then if tg_op='DELETE' then return old; else return new; end if; end if;
  select coalesce(nombre_fantasia,razon_social) into v_transport_name from public.transportes where id=v_config.transporte_id;
  v_before := nullif(v_old->>tg_argv[1],'')::numeric;
  v_after := nullif(v_new->>tg_argv[1],'')::numeric;
  if v_before is null and v_after is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if nullif(tg_argv[3],'') is not null then v_threshold := nullif(v_row->>tg_argv[3],'')::numeric; end if;
  v_label := case tg_argv[0]
    when 'bultos' then 'Bulto '||coalesce(v_threshold::text,'')
    when 'pallets' then case when tg_table_name='tarifas_pallet' then 'Pallet '||coalesce(v_threshold::text,'') else 'Pallet (precio fijo)' end
    when 'kg' then 'Kg '||coalesce(v_threshold::text,'')
    when 'camion_completo' then 'Camión completo'
    when 'servicios' then 'Servicio: '||coalesce((select nombre from public.servicios_transporte where id=(v_row->>'servicio_id')::uuid),'sin nombre')
    when 'tags' then 'Tag: '||coalesce((select nombre from public.tags where id=(v_row->>'tag_id')::uuid),'sin nombre')||' · '||tg_argv[1]
    else tg_argv[0] end;
  insert into public.historial_precios(usuario_id,usuario_nombre,transporte_id,transporte_nombre,configuracion_id,
    origen_provincia,origen_localidad,destino_provincia,destino_localidad,modalidad,desde,valor_anterior,valor_nuevo,
    registro_precio_id,concepto,etiqueta,columna_precio,evento_tipo)
  values(auth.uid(),public.auditoria_usuario_nombre(),v_config.transporte_id,v_transport_name,v_config_id,
    v_config.origen_provincia,v_config.origen_localidad,v_config.destino_provincia,v_config.destino_localidad,
    v_label,v_threshold,v_before,v_after,(v_row->>'id')::uuid,tg_argv[0],v_label,tg_argv[1],'manual');
  perform public.auditoria_registrar_movimiento('precio_actualizado',v_config.transporte_id,v_transport_name,v_config_id,
    v_config.origen_provincia,v_config.origen_localidad,v_config.destino_provincia,v_config.destino_localidad,v_label);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_auditoria_precio_camion on public.configuraciones_envio;
drop trigger if exists trg_auditoria_precio_bulto on public.tarifas_bulto;
drop trigger if exists trg_auditoria_precio_pallet on public.tarifas_pallet;
drop trigger if exists trg_auditoria_precio_kg on public.tarifas_kg;
create trigger trg_hist_precio_camion after insert or update or delete on public.configuraciones_envio for each row execute function public.auditoria_precio_matriz('camion_completo','precio_camion_completo','id','');
create trigger trg_hist_precio_pallet_fijo after insert or update or delete on public.configuraciones_envio for each row execute function public.auditoria_precio_matriz('pallets','precio_pallet','id','');
create trigger trg_hist_precio_bulto after insert or update or delete on public.tarifas_bulto for each row execute function public.auditoria_precio_matriz('bultos','precio','configuracion_id','desde_bulto');
create trigger trg_hist_precio_pallet after insert or update or delete on public.tarifas_pallet for each row execute function public.auditoria_precio_matriz('pallets','precio','configuracion_id','desde_pallet');
create trigger trg_hist_precio_kg after insert or update or delete on public.tarifas_kg for each row execute function public.auditoria_precio_matriz('kg','precio','configuracion_id','umbral_kg');
create trigger trg_hist_precio_servicio after insert or update or delete on public.configuracion_servicios for each row execute function public.auditoria_precio_matriz('servicios','valor','configuracion_id','');
create trigger trg_hist_precio_tag_bulto after insert or update or delete on public.configuracion_tag_precios for each row execute function public.auditoria_precio_matriz('tags','precio_bulto','configuracion_id','');
create trigger trg_hist_precio_tag_pallet after insert or update or delete on public.configuracion_tag_precios for each row execute function public.auditoria_precio_matriz('tags','precio_pallet','configuracion_id','');
create trigger trg_hist_precio_tag_kg after insert or update or delete on public.configuracion_tag_precios for each row execute function public.auditoria_precio_matriz('tags','precio_kg','configuracion_id','');
create trigger trg_hist_precio_tag_camion after insert or update or delete on public.configuracion_tag_precios for each row execute function public.auditoria_precio_matriz('tags','precio_camion_completo','configuracion_id','');

-- Los cambios masivos se registran exclusivamente en actualizaciones_precio_detalle.
create or replace function public.aplicar_actualizacion_precios(
  p_configuracion_ids uuid[],p_tipo_ajuste text,p_valor numeric,p_redondeo integer,
  p_conceptos text[],p_nota text default null,p_incluir_inactivas boolean default false
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_preview jsonb; v_id uuid; v_item jsonb; v_rows jsonb; v_count integer; v_fecha text;
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Permiso denegado: solo administradores pueden aplicar actualizaciones.' using errcode='42501'; end if;
  v_preview:=public.previsualizar_actualizacion_precios(p_configuracion_ids,p_tipo_ajuste,p_valor,p_redondeo,p_conceptos,p_incluir_inactivas);
  if (v_preview->>'bloqueantes')::integer>0 then raise exception 'La actualización produciría precios cero o negativos.' using errcode='22023'; end if;
  v_rows:=v_preview->'items'; if jsonb_array_length(v_rows)=0 then raise exception 'No hay precios para modificar.' using errcode='22023'; end if;
  insert into public.actualizaciones_precio(usuario_id,tipo_ajuste,valor,redondeo,conceptos,nota,cantidad_configuraciones,cantidad_precios_modificados)
  values(auth.uid(),p_tipo_ajuste,p_valor,p_redondeo,p_conceptos,nullif(trim(p_nota),''),(v_preview->>'cantidad_configuraciones')::integer,jsonb_array_length(v_rows)) returning id into v_id;
  perform set_config('app.precio_masivo_sin_trigger','true',true);
  for v_item in select value from jsonb_array_elements(v_rows) loop
    select columna_fecha_actualizacion into v_fecha from public.catalogo_campos_precio where tabla=v_item->>'tabla' and columna_precio=v_item->>'columna_precio';
    if v_fecha is null then
      execute format('update public.%I set %I=$1 where id=$2 and %I is not distinct from $3',v_item->>'tabla',v_item->>'columna_precio',v_item->>'columna_precio')
      using (v_item->>'precio_nuevo')::numeric,(v_item->>'registro_id')::uuid,(v_item->>'precio_anterior')::numeric;
    else
      execute format('update public.%I set %I=$1,%I=now() where id=$2 and %I is not distinct from $3',v_item->>'tabla',v_item->>'columna_precio',v_fecha,v_item->>'columna_precio')
      using (v_item->>'precio_nuevo')::numeric,(v_item->>'registro_id')::uuid,(v_item->>'precio_anterior')::numeric;
    end if;
    get diagnostics v_count=row_count; if v_count<>1 then raise exception 'El precio cambió durante la operación; no se aplicó ningún cambio.' using errcode='40001'; end if;
    insert into public.actualizaciones_precio_detalle(actualizacion_id,concepto,tabla,registro_id,configuracion_id,precio_anterior,precio_nuevo,columna_precio)
    values(v_id,v_item->>'concepto',v_item->>'tabla',(v_item->>'registro_id')::uuid,(v_item->>'configuracion_id')::uuid,(v_item->>'precio_anterior')::numeric,(v_item->>'precio_nuevo')::numeric,v_item->>'columna_precio');
  end loop;
  update public.configuraciones_envio set updated_at=now() where id=any(array(select distinct (e->>'configuracion_id')::uuid from jsonb_array_elements(v_rows)e));
  return jsonb_build_object('id',v_id,'cantidad_configuraciones',(v_preview->>'cantidad_configuraciones')::integer,'cantidad_precios',jsonb_array_length(v_rows));
end $$;

create or replace function public.revertir_actualizacion_precios(p_actualizacion_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_conflictos jsonb:='[]'::jsonb; v_detalle record; v_count integer; v_actual numeric;
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Permiso denegado: solo administradores pueden revertir actualizaciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.actualizaciones_precio where id=p_actualizacion_id and revertida_at is null) then raise exception 'La actualización no existe o ya fue revertida.' using errcode='22023'; end if;
  for v_detalle in select d.*,c.columna_fecha_actualizacion from public.actualizaciones_precio_detalle d join public.catalogo_campos_precio c on c.tabla=d.tabla and c.columna_precio=d.columna_precio where d.actualizacion_id=p_actualizacion_id loop
    if v_detalle.configuracion_id is null then v_conflictos:=v_conflictos||jsonb_build_array(jsonb_build_object('registro_id',v_detalle.registro_id,'tabla',v_detalle.tabla,'configuracion_eliminada',true));
    else
      execute format('select %I from public.%I where id=$1',v_detalle.columna_precio,v_detalle.tabla) into v_actual using v_detalle.registro_id;
      if v_actual is distinct from v_detalle.precio_nuevo then v_conflictos:=v_conflictos||jsonb_build_array(jsonb_build_object('registro_id',v_detalle.registro_id,'tabla',v_detalle.tabla,'precio_esperado',v_detalle.precio_nuevo,'precio_actual',v_actual)); end if;
    end if;
  end loop;
  if jsonb_array_length(v_conflictos)>0 then return jsonb_build_object('ok',false,'conflictos',v_conflictos); end if;
  perform set_config('app.precio_masivo_sin_trigger','true',true);
  for v_detalle in select d.*,c.columna_fecha_actualizacion from public.actualizaciones_precio_detalle d join public.catalogo_campos_precio c on c.tabla=d.tabla and c.columna_precio=d.columna_precio where d.actualizacion_id=p_actualizacion_id loop
    if v_detalle.columna_fecha_actualizacion is null then execute format('update public.%I set %I=$1 where id=$2 and %I is not distinct from $3',v_detalle.tabla,v_detalle.columna_precio,v_detalle.columna_precio) using v_detalle.precio_anterior,v_detalle.registro_id,v_detalle.precio_nuevo;
    else execute format('update public.%I set %I=$1,%I=now() where id=$2 and %I is not distinct from $3',v_detalle.tabla,v_detalle.columna_precio,v_detalle.columna_fecha_actualizacion,v_detalle.columna_precio) using v_detalle.precio_anterior,v_detalle.registro_id,v_detalle.precio_nuevo; end if;
    get diagnostics v_count=row_count; if v_count<>1 then raise exception 'Conflicto al revertir; no se aplicó ningún cambio.' using errcode='40001'; end if;
  end loop;
  update public.configuraciones_envio set updated_at=now() where id in(select distinct configuracion_id from public.actualizaciones_precio_detalle where actualizacion_id=p_actualizacion_id);
  update public.actualizaciones_precio set revertida_at=now(),revertida_por=auth.uid() where id=p_actualizacion_id;
  return jsonb_build_object('ok',true);
end $$;

-- Los detalles masivos guardan ruta y nombre para sobrevivir al borrado de la
-- configuración. Es un snapshot del evento, no una tabla paralela de precios.
create or replace function public.snapshot_detalle_precio_masivo()
returns trigger language plpgsql security definer set search_path=public
as $$
declare c public.configuraciones_envio%rowtype; v_name text;
begin
  select * into c from public.configuraciones_envio where id=new.configuracion_id;
  if not found then return new; end if;
  new.configuracion_id_original:=c.id;
  new.transporte_id:=c.transporte_id;
  new.configuracion_activa:=c.activo;
  select coalesce(t.nombre_fantasia,t.razon_social) into new.transporte_nombre from public.transportes t where t.id=c.transporte_id;
  new.origen_etiqueta:=coalesce((select 'Grupo '||g.nombre from public.grupos_sucursales g where g.id=c.origen_grupo_id),
    (select s.nombre from public.sucursales s where s.id=c.origen_sucursal_id),nullif(c.origen_nombre_personalizado,''),concat_ws(' · ',c.origen_provincia,c.origen_localidad),'Sin origen');
  new.destino_etiqueta:=coalesce(nullif(c.destino_nombre_personalizado,''),
    (select u.nombre from public.ubicaciones_personalizadas u where u.id=c.destino_ubicacion_personalizada_id),concat_ws(' · ',c.destino_provincia,c.destino_localidad),'Sin destino');
  if new.etiqueta is null and new.tabla='tarifas_bulto' then
    select 'Bulto '||desde_bulto::text into v_name from public.tarifas_bulto where id=new.registro_id;
  elsif new.etiqueta is null and new.tabla='tarifas_pallet' then
    select 'Pallet '||desde_pallet::text into v_name from public.tarifas_pallet where id=new.registro_id;
  elsif new.etiqueta is null and new.tabla='tarifas_kg' then
    select 'Kg '||coalesce(to_jsonb(k)->>'umbral_kg',to_jsonb(k)->>'desde_kg') into v_name from public.tarifas_kg k where id=new.registro_id;
  elsif new.etiqueta is null and new.tabla='configuracion_servicios' then
    select 'Servicio: '||s.nombre into v_name from public.configuracion_servicios cs join public.servicios_transporte s on s.id=cs.servicio_id where cs.id=new.registro_id;
  elsif new.etiqueta is null and new.tabla='configuracion_tag_precios' then
    select 'Tag: '||t.nombre||' · '||new.columna_precio into v_name from public.configuracion_tag_precios tp join public.tags t on t.id=tp.tag_id where tp.id=new.registro_id;
  end if;
  new.etiqueta:=coalesce(new.etiqueta,v_name,(select etiqueta from public.catalogo_campos_precio where tabla=new.tabla and columna_precio=new.columna_precio),new.concepto);
  return new;
end;
$$;
drop trigger if exists trg_snapshot_detalle_precio_masivo on public.actualizaciones_precio_detalle;
create trigger trg_snapshot_detalle_precio_masivo before insert on public.actualizaciones_precio_detalle for each row execute function public.snapshot_detalle_precio_masivo();

create or replace function public.snapshot_configuracion_eliminada_en_historial()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  update public.historial_precios set configuracion_id_original=old.id
  where configuracion_id=old.id and configuracion_id_original is null;
  update public.actualizaciones_precio_detalle set configuracion_id_original=old.id
  where configuracion_id=old.id and configuracion_id_original is null;
  return old;
end $$;
drop trigger if exists trg_snapshot_configuracion_eliminada_historial on public.configuraciones_envio;
create trigger trg_snapshot_configuracion_eliminada_historial before delete on public.configuraciones_envio
for each row execute function public.snapshot_configuracion_eliminada_en_historial();

update public.actualizaciones_precio_detalle d set
  transporte_id=c.transporte_id,
  transporte_nombre=coalesce(t.nombre_fantasia,t.razon_social),
  origen_etiqueta=coalesce((select 'Grupo '||g.nombre from public.grupos_sucursales g where g.id=c.origen_grupo_id),(select s.nombre from public.sucursales s where s.id=c.origen_sucursal_id),nullif(c.origen_nombre_personalizado,''),concat_ws(' · ',c.origen_provincia,c.origen_localidad),'Sin origen'),
  destino_etiqueta=coalesce(nullif(c.destino_nombre_personalizado,''),(select u.nombre from public.ubicaciones_personalizadas u where u.id=c.destino_ubicacion_personalizada_id),concat_ws(' · ',c.destino_provincia,c.destino_localidad),'Sin destino'),
  configuracion_activa=c.activo,
  configuracion_id_original=c.id,
  etiqueta=coalesce(d.etiqueta,
    case when d.tabla='tarifas_bulto' then 'Bulto '||(select desde_bulto::text from public.tarifas_bulto where id=d.registro_id)
      when d.tabla='tarifas_pallet' then 'Pallet '||(select desde_pallet::text from public.tarifas_pallet where id=d.registro_id)
      when d.tabla='tarifas_kg' then 'Kg '||(select coalesce(to_jsonb(k)->>'umbral_kg',to_jsonb(k)->>'desde_kg') from public.tarifas_kg k where k.id=d.registro_id)
      when d.tabla='configuracion_servicios' then 'Servicio: '||(select s.nombre from public.configuracion_servicios cs join public.servicios_transporte s on s.id=cs.servicio_id where cs.id=d.registro_id)
      when d.tabla='configuracion_tag_precios' then 'Tag: '||(select t.nombre from public.configuracion_tag_precios tp join public.tags t on t.id=tp.tag_id where tp.id=d.registro_id)||' · '||d.columna_precio
      else d.concepto end)
from public.configuraciones_envio c left join public.transportes t on t.id=c.transporte_id
where c.id=d.configuracion_id;

update public.historial_precios hp set
  configuracion_id_original=coalesce(hp.configuracion_id_original,hp.configuracion_id),
  registro_precio_id=coalesce(hp.registro_precio_id,
    (select b.id from public.tarifas_bulto b where b.configuracion_id=hp.configuracion_id and b.desde_bulto=hp.desde and lower(hp.modalidad) like 'bulto%' limit 1),
    (select p.id from public.tarifas_pallet p where p.configuracion_id=hp.configuracion_id and p.desde_pallet=hp.desde and lower(hp.modalidad) like 'pallet%' limit 1),
    (select k.id from public.tarifas_kg k where k.configuracion_id=hp.configuracion_id and coalesce(to_jsonb(k)->>'umbral_kg',to_jsonb(k)->>'desde_kg')::numeric=hp.desde and lower(hp.modalidad) like 'kg%' limit 1),
    (select c.id from public.configuraciones_envio c where c.id=hp.configuracion_id and lower(hp.modalidad) like 'camion%' limit 1)),
  concepto=coalesce(hp.concepto,case when lower(hp.modalidad) like 'bulto%' then 'bultos' when lower(hp.modalidad) like 'pallet%' then 'pallets' when lower(hp.modalidad) like 'kg%' then 'kg' when lower(hp.modalidad) like 'camion%' then 'camion_completo' end),
  etiqueta=coalesce(hp.etiqueta,hp.modalidad||case when hp.desde is null then '' else ' '||hp.desde::text end)
where hp.registro_precio_id is null;

-- Vista de lectura única. Los triggers históricos de una actualización masiva
-- se excluyen por timestamp + registro/valores; los eventos masivos y sus
-- reversiones se leen del detalle, que es la fuente transaccional autoritativa.
create or replace view public.eventos_precios_unificados as
select hp.id::text evento_id,hp.created_at fecha_hora,(hp.created_at at time zone 'America/Argentina/Cordoba')::date dia,
  'manual'::text tipo_cambio,null::uuid actualizacion_id,hp.usuario_id,coalesce(hp.transporte_id,c.transporte_id) transporte_id,
  coalesce(hp.transporte_nombre,t.nombre_fantasia,t.razon_social,'Transporte') transporte_nombre,coalesce(hp.configuracion_id,hp.configuracion_id_original) configuracion_id,
  coalesce(hp.registro_precio_id,md5(concat_ws('|',coalesce(hp.configuracion_id,hp.configuracion_id_original),hp.concepto,hp.modalidad,hp.desde))::uuid) registro_precio_id,
  coalesce(hp.concepto,case when lower(hp.modalidad) like 'bulto%' then 'bultos' when lower(hp.modalidad) like 'pallet%' then 'pallets' when lower(hp.modalidad) like 'kg%' then 'kg' when lower(hp.modalidad) like 'camion%' then 'camion_completo' else 'otros' end) concepto,
  hp.columna_precio,
  coalesce(hp.etiqueta,hp.modalidad||case when hp.desde is null then '' else ' '||hp.desde::text end) etiqueta,
  hp.valor_anterior precio_anterior,hp.valor_nuevo precio_nuevo,
  coalesce((select 'Grupo '||g.nombre from public.grupos_sucursales g where g.id=c.origen_grupo_id),(select s.nombre from public.sucursales s where s.id=c.origen_sucursal_id),hp.origen_localidad,hp.origen_provincia,'Sin origen') origen_etiqueta,
  c.origen_grupo_id is not null origen_es_grupo,
  coalesce(c.destino_nombre_personalizado,(select u.nombre from public.ubicaciones_personalizadas u where u.id=c.destino_ubicacion_personalizada_id),concat_ws(' · ',hp.destino_provincia,hp.destino_localidad),'Sin destino') destino_etiqueta,
  c.activo configuracion_activa,(c.id is null) configuracion_eliminada,null::text tipo_ajuste,null::numeric valor_ajuste,null::text[] conceptos_ajuste,null::text nota,
  null::integer cantidad_configuraciones,null::integer cantidad_precios_modificados,null::timestamptz revertida_at,null::uuid revertida_por
from public.historial_precios hp left join public.configuraciones_envio c on c.id=coalesce(hp.configuracion_id,hp.configuracion_id_original)
left join public.transportes t on t.id=coalesce(hp.transporte_id,c.transporte_id)
where not exists(select 1 from public.actualizaciones_precio_detalle d join public.actualizaciones_precio a on a.id=d.actualizacion_id
  where coalesce(d.configuracion_id,d.configuracion_id_original)=coalesce(hp.configuracion_id,hp.configuracion_id_original) and (d.registro_id=hp.registro_precio_id or hp.registro_precio_id is null)
    and d.precio_anterior=hp.valor_anterior and d.precio_nuevo=hp.valor_nuevo and hp.created_at=a.created_at)
  and not exists(select 1 from public.actualizaciones_precio_detalle d join public.actualizaciones_precio a on a.id=d.actualizacion_id
  where coalesce(d.configuracion_id,d.configuracion_id_original)=coalesce(hp.configuracion_id,hp.configuracion_id_original) and (d.registro_id=hp.registro_precio_id or hp.registro_precio_id is null)
    and hp.valor_anterior=d.precio_nuevo and hp.valor_nuevo=d.precio_anterior and hp.created_at=a.revertida_at)
union all
select concat(d.actualizacion_id,':masiva:',d.id),a.created_at,(a.created_at at time zone 'America/Argentina/Cordoba')::date,
  'masiva',a.id,a.usuario_id,d.transporte_id,coalesce(d.transporte_nombre,t.nombre_fantasia,t.razon_social,'Transporte'),
  coalesce(d.configuracion_id,d.configuracion_id_original),d.registro_id,d.concepto,d.columna_precio,coalesce(d.etiqueta,d.concepto),d.precio_anterior,d.precio_nuevo,
  coalesce(d.origen_etiqueta,'Configuración eliminada'),false,coalesce(d.destino_etiqueta,'Configuración eliminada'),case when d.configuracion_id is null then null else d.configuracion_activa end,(d.configuracion_id is null),
  a.tipo_ajuste,a.valor,a.conceptos,a.nota,a.cantidad_configuraciones,a.cantidad_precios_modificados,a.revertida_at,a.revertida_por
from public.actualizaciones_precio_detalle d join public.actualizaciones_precio a on a.id=d.actualizacion_id left join public.transportes t on t.id=d.transporte_id
union all
select concat(d.actualizacion_id,':reversion:',d.id),a.revertida_at,(a.revertida_at at time zone 'America/Argentina/Cordoba')::date,
  'reversion',a.id,a.revertida_por,d.transporte_id,coalesce(d.transporte_nombre,t.nombre_fantasia,t.razon_social,'Transporte'),
  coalesce(d.configuracion_id,d.configuracion_id_original),d.registro_id,d.concepto,d.columna_precio,coalesce(d.etiqueta,d.concepto),d.precio_nuevo,d.precio_anterior,
  coalesce(d.origen_etiqueta,'Configuración eliminada'),false,coalesce(d.destino_etiqueta,'Configuración eliminada'),case when d.configuracion_id is null then null else d.configuracion_activa end,(d.configuracion_id is null),
  a.tipo_ajuste,a.valor,a.conceptos,a.nota,a.cantidad_configuraciones,a.cantidad_precios_modificados,a.revertida_at,a.revertida_por
from public.actualizaciones_precio_detalle d join public.actualizaciones_precio a on a.id=d.actualizacion_id left join public.transportes t on t.id=d.transporte_id
where a.revertida_at is not null;

create or replace function public.buscar_transportes_historial(p_busqueda text)
returns table(id uuid,razon_social text,nombre_fantasia text) language sql stable security definer set search_path=public
as $$ select t.id,t.razon_social,t.nombre_fantasia from public.transportes t where auth.uid() is not null and t.activo
and public.normalizar_nombre_transporte(coalesce(t.nombre_fantasia,'')||' '||t.razon_social) like '%'||public.normalizar_nombre_transporte(trim(coalesce(p_busqueda,'')))||'%'
order by coalesce(t.nombre_fantasia,t.razon_social),t.razon_social limit 10 $$;

-- Capa 1: fechas y agregados por transporte, nunca filas de cada precio.
create or replace function public.historial_precios_matriz_resumen(p_transportes uuid[],p_desde date,p_hasta date,p_origen text default null,p_destino text default null,p_conceptos text[] default null,p_tipos text[] default null,p_umbral numeric default 10)
returns jsonb language plpgsql security definer set search_path=public
as $$ declare r jsonb; begin
if auth.uid() is null then raise exception 'Se requiere iniciar sesión.' using errcode='42501'; end if;
if coalesce(cardinality(p_transportes),0) not between 1 and 10 then raise exception 'Elegí entre 1 y 10 transportes.' using errcode='22023'; end if;
with e as (select x.*,coalesce(x.registro_precio_id::text,md5(concat_ws('|',x.configuracion_id,x.concepto,x.etiqueta)))||'|'||coalesce(x.columna_precio,'') precio_key from public.eventos_precios_unificados x where x.transporte_id=any(p_transportes) and x.dia<=p_hasta
and (p_origen is null or x.origen_etiqueta ilike '%'||p_origen||'%') and (p_destino is null or x.destino_etiqueta ilike '%'||p_destino||'%')
and (coalesce(cardinality(p_conceptos),0)=0 or x.concepto=any(p_conceptos))), days as (select distinct dia from e where dia>=p_desde and (coalesce(cardinality(p_tipos),0)=0 or tipo_cambio=any(p_tipos)) order by dia desc limit 24),
eff as (select case when count(distinct e.dia)>24 then coalesce((select min(dia)-1 from days),p_desde) else p_desde end desde from e where e.dia>=p_desde and (coalesce(cardinality(p_tipos),0)=0 or e.tipo_cambio=any(p_tipos))),
date_types as (select dia,case when count(distinct tipo_cambio)>1 then 'Mixto' when min(tipo_cambio)='masiva' then 'Masiva' when min(tipo_cambio)='manual' then 'Manual' else 'Reversión' end tipo from e where dia in(select dia from days) and (coalesce(cardinality(p_tipos),0)=0 or tipo_cambio=any(p_tipos)) group by dia),
var0 as (select e.*,first_value(precio_anterior) over(partition by precio_key,dia order by fecha_hora rows between unbounded preceding and unbounded following) dia_base,
last_value(precio_nuevo) over(partition by precio_key,dia order by fecha_hora rows between unbounded preceding and unbounded following) dia_cierre,
row_number() over(partition by precio_key,dia order by fecha_hora desc) rn from e where dia in(select dia from days)),
var as (select *,case when dia_base>0 and dia_cierre is not null then (dia_cierre/dia_base-1)*100 end cambio from var0 where rn=1),
bytr as (select transporte_id,dia,avg(cambio) cambio from var where cambio is not null group by transporte_id,dia),
price_keys as (select distinct on(precio_key) precio_key,transporte_id,configuracion_id,registro_precio_id,concepto,etiqueta from e order by precio_key,fecha_hora desc),
price_totals as (select k.*,
coalesce((select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia<(select desde from eff) order by x.fecha_hora desc limit 1),
(select x.precio_anterior from e x where x.precio_key=k.precio_key and x.dia>=(select desde from eff) order by x.fecha_hora limit 1),
(select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia>=(select desde from eff) order by x.fecha_hora limit 1)) base_precio,
(select x.precio_nuevo from e x where x.precio_key=k.precio_key order by x.fecha_hora desc limit 1) ultimo_precio from price_keys k),
ind as (select (select jsonb_build_object('valor',round((ultimo_precio/base_precio-1)*100,1),'transporte',coalesce((select transporte_nombre from e where e.transporte_id=p.transporte_id limit 1),'Transporte'),'detalle',p.concepto||' · '||p.etiqueta) from price_totals p where base_precio>0 order by ultimo_precio/base_precio desc limit 1) mayor,
avg((ultimo_precio/base_precio-1)*100) filter(where base_precio>0) promedio,count(*) filter(where base_precio>0) seguidos,
(select count(*) from var where cambio is not null and round(cambio,1)>=p_umbral) subas,(select count(*) from days) n_days,
(select count(distinct dia) from e where dia>=p_desde and (coalesce(cardinality(p_tipos),0)=0 or tipo_cambio=any(p_tipos)))>24 limite from price_totals)
select jsonb_build_object('fechas',coalesce((select jsonb_agg(jsonb_build_object('fecha',dia,'tipo',tipo) order by dia) from date_types),'[]'::jsonb),
'fecha_base',(select desde from eff),
'transportes',coalesce((select jsonb_agg(jsonb_build_object('transporte_id',t.id,'nombre',coalesce(t.nombre_fantasia,t.razon_social),'variaciones',coalesce((select jsonb_object_agg(dia::text,cambio) from bytr b where b.transporte_id=t.id),'{}'::jsonb),'acumulado',(select avg((ultimo_precio/base_precio-1)*100) from price_totals p where p.transporte_id=t.id and base_precio>0)) order by coalesce(t.nombre_fantasia,t.razon_social)) from public.transportes t where t.id=any(p_transportes)),'[]'::jsonb),
'indicadores',(select jsonb_build_object('mayor',mayor,'promedio',round(promedio,1),'precios_seguidos',seguidos,'subas',subas,'actualizaciones',n_days,'limite',limite) from ind)) into r;
return r; end $$;

-- Capa 2: rutas agregadas. No incluye filas de precios.
create or replace function public.historial_precios_matriz_rutas(p_transportes uuid[],p_transporte uuid,p_desde date,p_hasta date,p_origen text default null,p_destino text default null,p_conceptos text[] default null,p_tipos text[] default null,p_umbral numeric default 10)
returns jsonb language plpgsql security definer set search_path=public
as $$ declare r jsonb; begin
if auth.uid() is null then raise exception 'Se requiere iniciar sesión.' using errcode='42501'; end if;
if not p_transporte=any(p_transportes) then raise exception 'Transporte fuera del filtro.' using errcode='22023'; end if;
with e as (select x.*,coalesce(x.registro_precio_id::text,md5(concat_ws('|',x.configuracion_id,x.concepto,x.etiqueta)))||'|'||coalesce(x.columna_precio,'') precio_key from public.eventos_precios_unificados x where x.transporte_id=p_transporte and x.dia<=p_hasta
and (p_origen is null or x.origen_etiqueta ilike '%'||p_origen||'%') and (p_destino is null or x.destino_etiqueta ilike '%'||p_destino||'%') and (coalesce(cardinality(p_conceptos),0)=0 or concepto=any(p_conceptos))),
days as (select distinct dia from e where dia>=p_desde and (coalesce(cardinality(p_tipos),0)=0 or tipo_cambio=any(p_tipos)) order by dia desc limit 24),
eff as (select case when (select count(distinct dia) from e where dia>=p_desde and (coalesce(cardinality(p_tipos),0)=0 or tipo_cambio=any(p_tipos)))>24 then coalesce((select min(dia)-1 from days),p_desde) else p_desde end desde),
price_keys as (select distinct on(precio_key) precio_key,configuracion_id,transporte_id,origen_etiqueta,destino_etiqueta,configuracion_activa,configuracion_eliminada from e order by precio_key,fecha_hora desc),
price_totals as (select k.*,coalesce((select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia<(select desde from eff) order by x.fecha_hora desc limit 1),
(select x.precio_anterior from e x where x.precio_key=k.precio_key and x.dia>=(select desde from eff) order by x.fecha_hora limit 1),
(select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia>=(select desde from eff) order by x.fecha_hora limit 1)) base_precio,
(select x.precio_nuevo from e x where x.precio_key=k.precio_key order by x.fecha_hora desc limit 1) ultimo_precio from price_keys k),
agg as (select p.configuracion_id,p.transporte_id,max(p.origen_etiqueta) origen,max(p.destino_etiqueta) destino,bool_and(coalesce(p.configuracion_activa,true)) activa,bool_or(p.configuracion_eliminada) eliminada,
avg((p.ultimo_precio/p.base_precio-1)*100) filter(where p.base_precio>0) acumulado from price_totals p group by p.configuracion_id,p.transporte_id),
daily0 as (select e.*,first_value(precio_anterior) over(partition by precio_key,dia order by fecha_hora rows between unbounded preceding and unbounded following) dia_base,
last_value(precio_nuevo) over(partition by precio_key,dia order by fecha_hora rows between unbounded preceding and unbounded following) dia_cierre,
row_number() over(partition by precio_key,dia order by fecha_hora desc) rn from e where dia in(select dia from days)),
daily as (select configuracion_id,dia,avg((dia_cierre/dia_base-1)*100) filter(where dia_base>0 and dia_cierre is not null) cambio from daily0 where rn=1 group by configuracion_id,dia)
select coalesce(jsonb_agg(jsonb_build_object('configuracion_id',a.configuracion_id,'transporte_id',a.transporte_id,'origen',a.origen,'destino',a.destino,'activa',a.activa,'eliminada',a.eliminada,'acumulado',a.acumulado,
'variaciones',coalesce((select jsonb_object_agg(dia::text,cambio) from daily d where d.configuracion_id=a.configuracion_id),'{}'::jsonb)) order by a.origen,a.destino),'[]'::jsonb) into r from agg a;
return r; end $$;

-- Capa 3: filas de precio para una sola ruta. Los estados se calculan en SQL;
-- cada fecha consulta el último valor de ese registro hasta el cierre del día.
create or replace function public.historial_precios_matriz_precios(p_transportes uuid[],p_transporte uuid,p_configuracion uuid,p_desde date,p_hasta date,p_origen text default null,p_destino text default null,p_conceptos text[] default null,p_tipos text[] default null)
returns jsonb language plpgsql security definer set search_path=public
as $$ declare r jsonb; begin
if auth.uid() is null then raise exception 'Se requiere iniciar sesión.' using errcode='42501'; end if;
if not p_transporte=any(p_transportes) then raise exception 'Transporte fuera del filtro.' using errcode='22023'; end if;
with e as (select x.*,coalesce(x.registro_precio_id::text,md5(concat_ws('|',x.configuracion_id,x.concepto,x.etiqueta)))||'|'||coalesce(x.columna_precio,'') precio_key from public.eventos_precios_unificados x where x.transporte_id=p_transporte and x.configuracion_id=p_configuracion and x.dia<=p_hasta
and (p_origen is null or x.origen_etiqueta ilike '%'||p_origen||'%') and (p_destino is null or x.destino_etiqueta ilike '%'||p_destino||'%') and (coalesce(cardinality(p_conceptos),0)=0 or concepto=any(p_conceptos))),
days as (select distinct dia from public.eventos_precios_unificados x where x.transporte_id=any(p_transportes) and x.dia between p_desde and p_hasta
and (p_origen is null or x.origen_etiqueta ilike '%'||p_origen||'%') and (p_destino is null or x.destino_etiqueta ilike '%'||p_destino||'%') and (coalesce(cardinality(p_conceptos),0)=0 or concepto=any(p_conceptos))
and (coalesce(cardinality(p_tipos),0)=0 or tipo_cambio=any(p_tipos)) order by dia desc limit 24),
base_date as (select case when (select count(distinct x.dia) from public.eventos_precios_unificados x where x.transporte_id=any(p_transportes) and x.dia between p_desde and p_hasta
and (p_origen is null or x.origen_etiqueta ilike '%'||p_origen||'%') and (p_destino is null or x.destino_etiqueta ilike '%'||p_destino||'%') and (coalesce(cardinality(p_conceptos),0)=0 or x.concepto=any(p_conceptos))
and (coalesce(cardinality(p_tipos),0)=0 or x.tipo_cambio=any(p_tipos)))>24 then coalesce((select min(dia)-1 from days),p_desde) else p_desde end dia),
keys as (select distinct on(precio_key) precio_key,registro_precio_id,concepto,etiqueta from e order by precio_key,fecha_hora desc),
grid as (select k.*,c.dia,c.base,(select dia from base_date) effective_base,
case when c.base then coalesce((select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia<c.dia order by x.fecha_hora desc limit 1),(select x.precio_anterior from e x where x.precio_key=k.precio_key and x.dia>=c.dia order by x.fecha_hora limit 1))
else (select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia<=c.dia order by x.dia desc,x.fecha_hora desc limit 1) end precio,
(select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia=c.dia order by x.fecha_hora desc limit 1) cierre,
(coalesce((select x.precio_nuevo from e x where x.precio_key=k.precio_key and x.dia<c.dia order by x.dia desc,x.fecha_hora desc limit 1),
(select x.precio_anterior from e x where x.precio_key=k.precio_key and x.dia=c.dia order by x.fecha_hora limit 1))) previo,
exists(select 1 from e x where x.precio_key=k.precio_key and x.dia=c.dia) cambio
from keys k cross join (select dia,false base from days union all select dia,true from base_date) c),
cells as (select g.*,case when not base and cambio and previo>0 then (cierre/previo-1)*100 end variacion,
case when base then 0::numeric when precio is not null and coalesce((select x.precio_nuevo from e x where x.precio_key=g.precio_key and x.dia<g.effective_base order by x.dia desc,x.fecha_hora desc limit 1),
(select x.precio_anterior from e x where x.precio_key=g.precio_key and x.dia>=g.effective_base order by x.dia,x.fecha_hora limit 1),
(select x.precio_nuevo from e x where x.precio_key=g.precio_key and x.dia>=g.effective_base order by x.dia,x.fecha_hora limit 1))>0 then
(precio/coalesce((select x.precio_nuevo from e x where x.precio_key=g.precio_key and x.dia<g.effective_base order by x.dia desc,x.fecha_hora desc limit 1),(select x.precio_anterior from e x where x.precio_key=g.precio_key and x.dia>=g.effective_base order by x.dia,x.fecha_hora limit 1),(select x.precio_nuevo from e x where x.precio_key=g.precio_key and x.dia>=g.effective_base order by x.dia,x.fecha_hora limit 1))-1)*100 end acumulado from grid g)
select coalesce(jsonb_agg(jsonb_build_object('configuracion_id',p_configuracion,'transporte_id',p_transporte,'registro_id',registro_precio_id,'concepto',concepto,'etiqueta',etiqueta,
'celdas',(select jsonb_agg(jsonb_build_object('fecha',c.dia,'base',c.base,'tipo',null,'precio',c.precio,'variacion',c.variacion,'acumulado',c.acumulado,'nuevo',(c.base and c.precio is null) or (not c.base and c.cambio and c.previo is null and c.cierre is not null)) order by c.dia,c.base) from cells c where c.precio_key=cells.precio_key)) order by concepto,etiqueta),'[]'::jsonb) into r
from (select distinct on(precio_key) * from cells) cells;
return r; end $$;

create or replace function public.historial_precios_matriz_eventos_fecha(p_transportes uuid[],p_fecha date,p_desde date,p_hasta date,p_origen text default null,p_destino text default null,p_conceptos text[] default null,p_tipos text[] default null)
returns jsonb language plpgsql security definer set search_path=public
as $$ declare r jsonb; begin
if auth.uid() is null then raise exception 'Se requiere iniciar sesión.' using errcode='42501'; end if;
with filtered as (select e.*,p.nombre_completo usuario_nombre from public.eventos_precios_unificados e left join public.perfiles_usuario p on p.id=e.usuario_id
where e.transporte_id=any(p_transportes) and e.dia=p_fecha and e.dia between p_desde and p_hasta
and (p_origen is null or e.origen_etiqueta ilike '%'||p_origen||'%') and (p_destino is null or e.destino_etiqueta ilike '%'||p_destino||'%')
and (coalesce(cardinality(p_conceptos),0)=0 or e.concepto=any(p_conceptos)) and (coalesce(cardinality(p_tipos),0)=0 or e.tipo_cambio=any(p_tipos))),
ranked as (select f.*,count(*) over(partition by tipo_cambio,coalesce(actualizacion_id::text,usuario_id::text||transporte_id::text||dia::text)) precios_editados,
row_number() over(partition by tipo_cambio,coalesce(actualizacion_id::text,usuario_id::text||transporte_id::text||dia::text) order by fecha_hora) rn from filtered f)
select coalesce(jsonb_agg(jsonb_build_object('tipo_cambio',e.tipo_cambio,'fecha_hora',e.fecha_hora,'transporte_nombre',e.transporte_nombre,
'usuario_nombre',coalesce(e.usuario_nombre,'Usuario'),'actualizacion_id',e.actualizacion_id,'tipo_ajuste',e.tipo_ajuste,'valor_ajuste',e.valor_ajuste,
'conceptos_ajuste',e.conceptos_ajuste,'nota',e.nota,'cantidad_configuraciones',e.cantidad_configuraciones,'cantidad_precios_modificados',e.cantidad_precios_modificados,
'precios_editados',e.precios_editados,'revertida_at',e.revertida_at,'etiqueta',e.etiqueta,'precio_anterior',e.precio_anterior,'precio_nuevo',e.precio_nuevo) order by e.fecha_hora),'[]'::jsonb) into r from ranked e where rn=1;
return r; end $$;

create or replace function public.buscar_transportes_historial(p_busqueda text)
returns table(id uuid,razon_social text,nombre_fantasia text) language sql stable security definer set search_path=public
as $$ select t.id,t.razon_social,t.nombre_fantasia from public.transportes t where auth.uid() is not null and t.activo
and public.normalizar_nombre_transporte(coalesce(t.nombre_fantasia,'')||' '||t.razon_social) like '%'||public.normalizar_nombre_transporte(trim(coalesce(p_busqueda,'')))||'%'
order by coalesce(t.nombre_fantasia,t.razon_social),t.razon_social limit 10 $$;

revoke all on function public.historial_precios_matriz_resumen(uuid[],date,date,text,text,text[],text[],numeric) from public;
revoke all on function public.historial_precios_matriz_rutas(uuid[],uuid,date,date,text,text,text[],text[],numeric) from public;
revoke all on function public.historial_precios_matriz_precios(uuid[],uuid,uuid,date,date,text,text,text[],text[]) from public;
revoke all on function public.historial_precios_matriz_eventos_fecha(uuid[],date,date,date,text,text,text[],text[]) from public;
grant execute on function public.historial_precios_matriz_resumen(uuid[],date,date,text,text,text[],text[],numeric) to authenticated;
grant execute on function public.historial_precios_matriz_rutas(uuid[],uuid,date,date,text,text,text[],text[],numeric) to authenticated;
grant execute on function public.historial_precios_matriz_precios(uuid[],uuid,uuid,date,date,text,text,text[],text[]) to authenticated;
grant execute on function public.historial_precios_matriz_eventos_fecha(uuid[],date,date,date,text,text,text[],text[]) to authenticated;
grant execute on function public.buscar_transportes_historial(text) to authenticated;
notify pgrst,'reload schema';
