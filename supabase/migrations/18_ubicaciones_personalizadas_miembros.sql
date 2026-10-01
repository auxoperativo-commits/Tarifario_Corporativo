-- =========================================================
-- MIGRACION 18: miembros de ubicaciones personalizadas
-- =========================================================

create table if not exists ubicacion_personalizada_miembros (
  id uuid primary key default uuid_generate_v4(),
  ubicacion_personalizada_id uuid not null references ubicaciones_personalizadas(id) on delete cascade,
  provincia text not null,
  localidad text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ubicacion_personalizada_miembros_personalizada
  on ubicacion_personalizada_miembros (ubicacion_personalizada_id);

create unique index if not exists ux_ubicacion_personalizada_miembros
  on ubicacion_personalizada_miembros (ubicacion_personalizada_id, provincia, localidad) nulls not distinct;

alter table ubicacion_personalizada_miembros enable row level security;

create policy "ubicacion_personalizada_miembros_own_read" on ubicacion_personalizada_miembros
  for select using (
    exists (
      select 1 from ubicaciones_personalizadas up
      where up.id = ubicacion_personalizada_id and up.usuario_id = auth.uid()
    )
  );

create policy "ubicacion_personalizada_miembros_own_write" on ubicacion_personalizada_miembros
  for all using (
    exists (
      select 1 from ubicaciones_personalizadas up
      where up.id = ubicacion_personalizada_id and up.usuario_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from ubicaciones_personalizadas up
      where up.id = ubicacion_personalizada_id and up.usuario_id = auth.uid()
    )
  );

create trigger trg_ubicacion_personalizada_miembros_updated_at
  before update on ubicacion_personalizada_miembros
  for each row execute function set_updated_at();

insert into ubicacion_personalizada_miembros (ubicacion_personalizada_id, provincia, localidad)
select up.id, up.provincia, up.localidad
from ubicaciones_personalizadas up
where trim(up.provincia) <> ''
  and not exists (
    select 1
    from ubicacion_personalizada_miembros m
    where m.ubicacion_personalizada_id = up.id
      and m.provincia = up.provincia
      and coalesce(m.localidad, '') = coalesce(up.localidad, '')
  );
