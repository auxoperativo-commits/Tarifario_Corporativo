-- =========================================================
-- MIGRACION 03: datos de contacto de transportes
-- Ejecutar en el SQL Editor de Supabase
-- =========================================================

alter table transportes
  add column if not exists telefono text,
  add column if not exists correo text;
