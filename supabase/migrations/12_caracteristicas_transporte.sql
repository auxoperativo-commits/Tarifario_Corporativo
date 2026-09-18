-- =========================================================
-- MIGRACIÓN 12: Características de Transporte
-- Atributos cualitativos sin costo asociado (ej: "Rápido",
-- "Limpio") que sirven para filtrar pero no afectan precios.
-- Diferente de "tags" que sí tienen valor económico.
-- =========================================================

create table if not exists caracteristicas_transporte (
  id         uuid primary key default uuid_generate_v4(),
  nombre     text not null,
  color      text not null default '#6b7280',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nombre)
);

create index if not exists idx_caracteristicas_nombre
  on caracteristicas_transporte (nombre);

alter table caracteristicas_transporte enable row level security;

create policy "caracteristicas_read_authenticated" on caracteristicas_transporte
  for select using (auth.role() = 'authenticated');

create policy "caracteristicas_admin_write" on caracteristicas_transporte
  for all using (public.es_admin()) with check (public.es_admin());

drop trigger if exists trg_caracteristicas_updated_at on caracteristicas_transporte;
create trigger trg_caracteristicas_updated_at
  before update on caracteristicas_transporte
  for each row execute function set_updated_at();

-- ── Tabla intermedia ───────────────────────────────────────────────────────────

create table if not exists configuracion_caracteristicas (
  configuracion_id uuid not null
    references configuraciones_envio(id) on delete cascade,
  caracteristica_id uuid not null
    references caracteristicas_transporte(id) on delete cascade,
  primary key (configuracion_id, caracteristica_id)
);

create index if not exists idx_config_caract_config
  on configuracion_caracteristicas (configuracion_id);
create index if not exists idx_config_caract_caract
  on configuracion_caracteristicas (caracteristica_id);

alter table configuracion_caracteristicas enable row level security;

create policy "config_caract_read_authenticated" on configuracion_caracteristicas
  for select using (auth.role() = 'authenticated');

create policy "config_caract_write_authenticated" on configuracion_caracteristicas
  for all using (auth.role() = 'authenticated');
