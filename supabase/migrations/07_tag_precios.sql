-- =========================================================
-- MIGRACIÓN 07: Precios de Tags por configuración
-- Motor: PostgreSQL (Supabase)
--
-- Cada fila guarda el costo adicional de un tag específico
-- dentro de una configuración de envío.
-- Los precios son opcionales por unidad (NULL = sin costo extra).
-- =========================================================

create table if not exists configuracion_tag_precios (
  id                   uuid primary key default uuid_generate_v4(),
  configuracion_id     uuid not null references configuraciones_envio(id) on delete cascade,
  tag_id               uuid not null references tags(id) on delete cascade,

  -- Precios opcionales por unidad de envío
  precio_bulto         numeric(12,2) check (precio_bulto >= 0),
  precio_pallet        numeric(12,2) check (precio_pallet >= 0),
  precio_kg            numeric(12,2) check (precio_kg >= 0),
  precio_camion_completo numeric(12,2) check (precio_camion_completo >= 0),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Una sola fila por (configuración, tag)
  unique (configuracion_id, tag_id)
);

comment on table configuracion_tag_precios is
  'Precio adicional por unidad de envío asociado a un tag dentro de una configuración de envío específica.';

comment on column configuracion_tag_precios.precio_bulto is
  'Costo adicional fijo por bulto al incluir este tag (ej: $20.000 por bulto con cadena de frío).';
comment on column configuracion_tag_precios.precio_pallet is
  'Costo adicional fijo por pallet al incluir este tag.';
comment on column configuracion_tag_precios.precio_kg is
  'Costo adicional fijo por el lote de kg indicado al incluir este tag.';
comment on column configuracion_tag_precios.precio_camion_completo is
  'Costo adicional fijo por camión completo al incluir este tag.';

-- Índices para consultas por configuración o por tag
create index idx_config_tag_precios_config on configuracion_tag_precios (configuracion_id);
create index idx_config_tag_precios_tag    on configuracion_tag_precios (tag_id);

-- Row Level Security
alter table configuracion_tag_precios enable row level security;

create policy "auth_read_config_tag_precios" on configuracion_tag_precios
  for select using (auth.role() = 'authenticated');

create policy "auth_write_config_tag_precios" on configuracion_tag_precios
  for all using (auth.role() = 'authenticated');

-- Trigger para updated_at automático
create trigger trg_config_tag_precios_updated_at
  before update on configuracion_tag_precios
  for each row execute function set_updated_at();
