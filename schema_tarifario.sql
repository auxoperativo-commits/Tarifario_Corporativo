-- =========================================================
-- TARIFARIO SALUD RENAL - Esquema de base de datos
-- Motor: PostgreSQL (Supabase)
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- TRANSPORTES
-- ---------------------------------------------------------
create table transportes (
  id uuid primary key default uuid_generate_v4(),
  razon_social text not null,
  nombre_fantasia text,
  cuit varchar(13),
  telefono text,
  correo text,
  observacion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table transportes is 'Empresas de transporte registradas en el sistema';

-- ---------------------------------------------------------
-- TAGS (Urgente, Rapido, Economico, etc) para filtrar configuraciones
-- ---------------------------------------------------------
create table tags (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null unique,
  color text default '#6b7280'
);

-- ---------------------------------------------------------
-- CONFIGURACIONES DE ENVIO
-- Cada fila = una ruta (origen -> destino) configurada para un transporte
-- Un mismo transporte puede tener N configuraciones (N rutas)
-- ---------------------------------------------------------
create table configuraciones_envio (
  id uuid primary key default uuid_generate_v4(),
  transporte_id uuid not null references transportes(id) on delete cascade,

  origen_provincia text not null,
  origen_localidad text,      -- null = aplica a toda la provincia
  destino_provincia text not null,
  destino_localidad text,     -- null = aplica a toda la provincia

  -- tiempos estimados de entrega (permite un rango, ej 12hs a 24hs)
  tiempo_estimado_min_horas numeric(6,1),
  tiempo_estimado_max_horas numeric(6,1),

  -- precio fijo por pallet (incluye los bultos que se quieran dentro del pallet)
  precio_pallet numeric(12,2),

  -- precio fijo por camion completo
  precio_camion_completo numeric(12,2),

  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_config_origen  on configuraciones_envio (origen_provincia, origen_localidad);
create index idx_config_destino on configuraciones_envio (destino_provincia, destino_localidad);
create index idx_config_transporte on configuraciones_envio (transporte_id);

-- ---------------------------------------------------------
-- TARIFAS ESCALONADAS POR BULTO
-- Permite N tramos de precio. Ejemplo:
--   desde_bulto = 1 -> precio 18000  (el primer bulto)
--   desde_bulto = 2 -> precio 5000   (el segundo bulto en adelante)
--   desde_bulto = 6 -> precio 4000   (a partir del sexto, si se quiere agregar otro tramo)
-- El precio total se calcula recorriendo cada bulto y aplicando el tramo
-- vigente (el de mayor "desde_bulto" que sea <= al numero de bulto).
-- ---------------------------------------------------------
create table tarifas_bulto (
  id uuid primary key default uuid_generate_v4(),
  configuracion_id uuid not null references configuraciones_envio(id) on delete cascade,
  desde_bulto integer not null check (desde_bulto >= 1),
  precio numeric(12,2) not null check (precio >= 0),
  unique (configuracion_id, desde_bulto)
);

create index idx_tarifas_bulto_config on tarifas_bulto (configuracion_id);

-- ---------------------------------------------------------
-- RELACION CONFIGURACION <-> TAGS (muchos a muchos)
-- ---------------------------------------------------------
create table configuracion_tags (
  configuracion_id uuid not null references configuraciones_envio(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (configuracion_id, tag_id)
);

-- ---------------------------------------------------------
-- PERFILES DE USUARIO (extiende auth.users de Supabase)
-- Guarda el rol y el origen/destino predeterminado de cada empleado
-- ---------------------------------------------------------
create table perfiles_usuario (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text,
  rol text not null default 'operario' check (rol in ('operario','compras','licitaciones','gerencia','admin')),

  origen_predeterminado_provincia text,
  origen_predeterminado_localidad text,
  destino_predeterminado_provincia text,
  destino_predeterminado_localidad text,

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- HISTORIAL DE CALCULOS (opcional pero recomendado: sirve para analitica,
-- saber que rutas se consultan mas, auditar precios usados, etc)
-- ---------------------------------------------------------
create table historial_calculos (
  id uuid primary key default uuid_generate_v4(),
  usuario_id uuid references auth.users(id),

  origen_provincia text not null,
  origen_localidad text,
  destino_provincia text not null,
  destino_localidad text,

  tipo_envio text not null check (tipo_envio in ('bultos','pallet','camion_completo')),
  cantidad integer,

  transporte_elegido_id uuid references transportes(id),
  precio_resultado numeric(12,2),

  created_at timestamptz not null default now()
);

create index idx_historial_usuario on historial_calculos (usuario_id);
create index idx_historial_fecha on historial_calculos (created_at desc);

-- =========================================================
-- ROW LEVEL SECURITY (obligatorio en Supabase)
-- Politica simple para arrancar: cualquier usuario autenticado
-- de la empresa puede leer y escribir. Se puede restringir despues
-- por rol (ej: solo compras/admin puede editar configuraciones).
-- =========================================================
alter table transportes            enable row level security;
alter table configuraciones_envio  enable row level security;
alter table tarifas_bulto          enable row level security;
alter table tags                   enable row level security;
alter table configuracion_tags     enable row level security;
alter table perfiles_usuario       enable row level security;
alter table historial_calculos     enable row level security;

create policy "auth_read_transportes" on transportes
  for select using (auth.role() = 'authenticated');
create policy "auth_write_transportes" on transportes
  for all using (auth.role() = 'authenticated');

create policy "auth_read_config" on configuraciones_envio
  for select using (auth.role() = 'authenticated');
create policy "auth_write_config" on configuraciones_envio
  for all using (auth.role() = 'authenticated');

create policy "auth_read_tarifas" on tarifas_bulto
  for select using (auth.role() = 'authenticated');
create policy "auth_write_tarifas" on tarifas_bulto
  for all using (auth.role() = 'authenticated');

create policy "auth_read_tags" on tags
  for select using (auth.role() = 'authenticated');
create policy "auth_write_tags" on tags
  for all using (auth.role() = 'authenticated');

create policy "auth_read_config_tags" on configuracion_tags
  for select using (auth.role() = 'authenticated');
create policy "auth_write_config_tags" on configuracion_tags
  for all using (auth.role() = 'authenticated');

create policy "auth_read_perfil_propio" on perfiles_usuario
  for select using (auth.role() = 'authenticated');
create policy "auth_write_perfil_propio" on perfiles_usuario
  for all using (auth.uid() = id);

create policy "auth_read_historial" on historial_calculos
  for select using (auth.role() = 'authenticated');
create policy "auth_write_historial" on historial_calculos
  for insert with check (auth.role() = 'authenticated');

-- =========================================================
-- TRIGGER para updated_at automatico
-- =========================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_transportes_updated_at
  before update on transportes
  for each row execute function set_updated_at();

create trigger trg_config_updated_at
  before update on configuraciones_envio
  for each row execute function set_updated_at();

-- =========================================================
-- DATOS DE EJEMPLO (opcional, para probar el sistema)
-- =========================================================
insert into tags (nombre, color) values
  ('Urgente', '#ef4444'),
  ('Economico', '#22c55e'),
  ('Rapido', '#3b82f6');

-- Ejemplo de un transporte con una configuracion Cordoba -> Buenos Aires
with t as (
  insert into transportes (razon_social, cuit)
  values ('Transporte Ejemplo SRL', '30-12345678-9')
  returning id
),
c as (
  insert into configuraciones_envio (
    transporte_id, origen_provincia, destino_provincia,
    tiempo_estimado_min_horas, tiempo_estimado_max_horas,
    precio_pallet, precio_camion_completo
  )
  select id, 'Córdoba', 'Buenos Aires', 12, 24, 90000, 450000 from t
  returning id
)
insert into tarifas_bulto (configuracion_id, desde_bulto, precio)
select id, 1, 18000 from c
union all
select id, 2, 5000 from c;
