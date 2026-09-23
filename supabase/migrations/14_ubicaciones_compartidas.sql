-- =========================================================
-- MIGRACIÓN 14: Ubicaciones personalizadas compartidas
-- Las ubicaciones personalizadas deben ser visibles para
-- todos los usuarios autenticados (para poder buscar con
-- cualquier usuario), pero cada uno solo puede modificar
-- las propias.
-- =========================================================

-- Reemplazar la policy de lectura restrictiva por una que
-- permite a cualquier usuario autenticado ver todas las
-- ubicaciones personalizadas.
drop policy if exists "ubicaciones_personalizadas_own_read" on ubicaciones_personalizadas;

create policy "ubicaciones_personalizadas_read_authenticated" on ubicaciones_personalizadas
  for select using (auth.role() = 'authenticated');

-- La policy de escritura no cambia: cada uno solo modifica las suyas.
-- (ubicaciones_personalizadas_own_write ya existe y permanece igual)
