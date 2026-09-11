-- Indices for filters, relationships, and ordering used by the application.
-- They are idempotent and do not change data or RLS policies.

create index if not exists idx_config_transporte_created_at
  on configuraciones_envio (transporte_id, created_at desc);

create index if not exists idx_config_origen_ubicacion
  on configuraciones_envio (origen_ubicacion_personalizada_id);

create index if not exists idx_config_destino_ubicacion
  on configuraciones_envio (destino_ubicacion_personalizada_id);

create index if not exists idx_configuracion_tags_tag
  on configuracion_tags (tag_id);

create index if not exists idx_ubicaciones_usuario_nombre
  on ubicaciones_personalizadas (usuario_id, nombre);

create index if not exists idx_contenedores_usuario_created_at
  on contenedores (usuario_id, created_at desc);

do $$
begin
  if to_regclass('public.tarifas_kg') is not null then
    execute 'create index if not exists idx_tarifas_kg_config on public.tarifas_kg (configuracion_id)';
  end if;
end;
$$;
