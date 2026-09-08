-- =========================================================
-- MIGRACION 05: fecha de actualización por modalidad de precio
-- =========================================================

alter table configuraciones_envio
  add column if not exists precio_camion_actualizado_at timestamptz;

alter table tarifas_bulto
  add column if not exists updated_at timestamptz not null default now();

alter table tarifas_pallet
  add column if not exists updated_at timestamptz not null default now();

-- Los registros existentes toman la fecha de actualización de su configuración
-- hasta que se modifique cada modalidad nuevamente.
update tarifas_bulto b
set updated_at = c.updated_at
from configuraciones_envio c
where c.id = b.configuracion_id;

update tarifas_pallet p
set updated_at = c.updated_at
from configuraciones_envio c
where c.id = p.configuracion_id;

update configuraciones_envio
set precio_camion_actualizado_at = updated_at
where precio_camion_completo is not null
  and precio_camion_actualizado_at is null;