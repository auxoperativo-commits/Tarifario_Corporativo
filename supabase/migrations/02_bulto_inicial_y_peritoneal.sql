-- =========================================================
-- MIGRACIÓN 02: valor_inicial en tarifas_bulto + apto_peritoneal
-- Ejecutar en el SQL Editor de Supabase
-- =========================================================

-- 1. Campo en tarifas_bulto: indica si el tramo del bulto 1
--    siempre se cobra (suma al resto) o si desde cierta cantidad
--    todo se multiplica por el tramo vigente.
--    Solo aplica al tramo con desde_bulto = 1.
alter table tarifas_bulto
  add column if not exists es_valor_inicial boolean not null default false;

-- 2. Campo en configuraciones_envio: indica si el transporte
--    está habilitado para llevar productos de diálisis peritoneal.
alter table configuraciones_envio
  add column if not exists apto_peritoneal boolean not null default false;

-- Las configuraciones existentes quedan con apto_peritoneal = false
-- y es_valor_inicial = false (comportamiento anterior: todo se multiplica)
