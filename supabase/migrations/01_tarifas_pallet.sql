-- =========================================================
-- TARIFAS ESCALONADAS POR PALLET
-- Misma lógica que tarifas_bulto pero para pallets.
-- Permite definir tramos tipo:
--   desde_pallet = 1     -> precio 90000  (primer pallet)
--   desde_pallet = 2     -> precio 70000  (segundo pallet en adelante)
-- También soporta medios pallets usando decimales:
--   desde_pallet = 0.5  -> precio 50000  (medio pallet)
-- =========================================================
create table if not exists tarifas_pallet (
  id uuid primary key default uuid_generate_v4(),
  configuracion_id uuid not null references configuraciones_envio(id) on delete cascade,
  desde_pallet numeric(6,2) not null check (desde_pallet > 0),
  precio numeric(12,2) not null check (precio >= 0),
  unique (configuracion_id, desde_pallet)
);

create index if not exists idx_tarifas_pallet_config on tarifas_pallet (configuracion_id);

-- RLS
alter table tarifas_pallet enable row level security;

create policy "auth_read_tarifas_pallet" on tarifas_pallet
  for select using (auth.role() = 'authenticated');
create policy "auth_write_tarifas_pallet" on tarifas_pallet
  for all using (auth.role() = 'authenticated');
