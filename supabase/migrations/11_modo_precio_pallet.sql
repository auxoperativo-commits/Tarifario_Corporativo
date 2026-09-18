-- Permite interpretar el precio de pallets como unitario o como total del tramo.
-- Esta migración es incremental porque la migración 10 puede haberse ejecutado previamente.

alter table public.configuraciones_envio
  add column if not exists modo_precio_pallet text;

update public.configuraciones_envio
set modo_precio_pallet = 'precio_por_unidad'
where modo_precio_pallet is null
   or modo_precio_pallet not in ('precio_por_unidad', 'precio_total_tramo');

alter table public.configuraciones_envio
  alter column modo_precio_pallet set default 'precio_por_unidad',
  alter column modo_precio_pallet set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.configuraciones_envio'::regclass
      and conname = 'configuraciones_envio_modo_precio_pallet_check'
  ) then
    alter table public.configuraciones_envio
      add constraint configuraciones_envio_modo_precio_pallet_check
      check (modo_precio_pallet in ('precio_por_unidad', 'precio_total_tramo'));
  end if;
end;
$$;
