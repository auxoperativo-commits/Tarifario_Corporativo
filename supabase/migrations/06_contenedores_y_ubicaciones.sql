-- =========================================================
-- MIGRACION 06: contenedores personales y ubicaciones personalizadas
-- =========================================================

create table if not exists ubicaciones_personalizadas (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  provincia text not null,
  localidad text,
  created_at timestamptz not null default now(),
  unique (usuario_id, nombre)
);

create table if not exists contenedores (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usuario_id, nombre)
);

create table if not exists contenedor_cotizaciones (
  id uuid primary key default uuid_generate_v4(),
  contenedor_id uuid not null references contenedores(id) on delete cascade,
  configuracion_id uuid,
  transporte_id uuid,
  transporte_nombre text,
  origen_provincia text,
  origen_localidad text,
  origen_nombre_personalizado text,
  destino_provincia text,
  destino_localidad text,
  destino_nombre_personalizado text,
  precio_total numeric(12,2),
  cantidad_bultos integer not null default 0,
  cantidad_pallets numeric(12,2) not null default 0,
  cantidad_kg numeric(12,2) not null default 0,
  descripcion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ubicaciones_usuario on ubicaciones_personalizadas (usuario_id);
create index if not exists idx_contenedores_usuario on contenedores (usuario_id);
create index if not exists idx_contenedor_cotizaciones_contenedor on contenedor_cotizaciones (contenedor_id);

alter table ubicaciones_personalizadas enable row level security;
alter table contenedores enable row level security;
alter table contenedor_cotizaciones enable row level security;

create policy "ubicaciones_personalizadas_own_read" on ubicaciones_personalizadas
  for select using (auth.uid() = usuario_id);
create policy "ubicaciones_personalizadas_own_write" on ubicaciones_personalizadas
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

create policy "contenedores_own_read" on contenedores
  for select using (auth.uid() = usuario_id);
create policy "contenedores_own_write" on contenedores
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

create policy "contenedor_cotizaciones_own_read" on contenedor_cotizaciones
  for select using (
    exists (
      select 1 from contenedores c
      where c.id = contenedor_id and c.usuario_id = auth.uid()
    )
  );
create policy "contenedor_cotizaciones_own_write" on contenedor_cotizaciones
  for all using (
    exists (
      select 1 from contenedores c
      where c.id = contenedor_id and c.usuario_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from contenedores c
      where c.id = contenedor_id and c.usuario_id = auth.uid()
    )
  );

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_contenedores_updated_at
  before update on contenedores
  for each row execute function set_updated_at();

alter table configuraciones_envio add column if not exists origen_nombre_personalizado text;
alter table configuraciones_envio add column if not exists origen_ubicacion_personalizada_id uuid references ubicaciones_personalizadas(id) on delete set null;
alter table configuraciones_envio add column if not exists destino_nombre_personalizado text;
alter table configuraciones_envio add column if not exists destino_ubicacion_personalizada_id uuid references ubicaciones_personalizadas(id) on delete set null;
alter table contenedor_cotizaciones add column if not exists origen_nombre_personalizado text;
alter table contenedor_cotizaciones add column if not exists destino_nombre_personalizado text;
