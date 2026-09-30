-- =========================================================
-- MIGRACIÓN 17: Servicios de Transporte
-- Servicios fijos por configuración, con valor monetario
-- asociado al costo total final del envío.
-- =========================================================

create table if not exists servicios_transporte (
  id         uuid primary key default uuid_generate_v4(),
  nombre     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nombre)
);

create index if not exists idx_servicios_transporte_nombre
  on servicios_transporte (nombre);

alter table servicios_transporte enable row level security;

create policy "servicios_read_authenticated" on servicios_transporte
  for select using (auth.role() = 'authenticated');

create policy "servicios_admin_write" on servicios_transporte
  for all using (public.es_admin()) with check (public.es_admin());

drop trigger if exists trg_servicios_transporte_updated_at on servicios_transporte;
create trigger trg_servicios_transporte_updated_at
  before update on servicios_transporte
  for each row execute function set_updated_at();

-- ── Tabla intermedia: servicios asignados a una configuración ─────────────────

create table if not exists configuracion_servicios (
  id              uuid primary key default uuid_generate_v4(),
  configuracion_id uuid not null references configuraciones_envio(id) on delete cascade,
  servicio_id     uuid not null references servicios_transporte(id) on delete cascade,
  valor           numeric(12,2) not null check (valor >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (configuracion_id, servicio_id)
);

create index if not exists idx_config_servicios_config
  on configuracion_servicios (configuracion_id);
create index if not exists idx_config_servicios_servicio
  on configuracion_servicios (servicio_id);

alter table configuracion_servicios enable row level security;

create policy "config_servicios_read_authenticated" on configuracion_servicios
  for select using (auth.role() = 'authenticated');

create policy "config_servicios_write_authenticated" on configuracion_servicios
  for all using (auth.role() = 'authenticated');

drop trigger if exists trg_config_servicios_updated_at on configuracion_servicios;
create trigger trg_config_servicios_updated_at
  before update on configuracion_servicios
  for each row execute function set_updated_at();
