-- =========================================================
-- MIGRACIÓN 13: Nombre opcional para cotizaciones en contenedores
-- Permite etiquetar cada cotización con un nombre libre
-- (ej: "Envío urgente licitación X") para identificarla
-- rápidamente sin afectar la lógica de cálculo.
-- =========================================================

alter table contenedor_cotizaciones
  add column if not exists nombre text;
