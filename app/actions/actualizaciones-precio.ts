'use server';

import { createClient } from '@/lib/supabase/server';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, error: 'La sesión expiró.' };
  const { data: perfil } = await supabase.from('perfiles_usuario').select('rol').eq('id', user.id).single();
  if (perfil?.rol !== 'admin') return { supabase, error: 'Solo un administrador puede usar esta función.' };
  return { supabase, error: null };
}

export async function obtenerCatalogoPrecios() {
  const { supabase, error } = await requireAdmin();
  if (error) return { error };
  const { data, error: dbError } = await supabase.from('catalogo_campos_precio').select('*').eq('activo', true).order('concepto');
  return dbError ? { error: dbError.message } : { data: data ?? [] };
}

export async function obtenerHistorialPrecios() {
  const { supabase, error } = await requireAdmin();
  if (error) return { error };
  const { data, error: dbError } = await supabase.from('actualizaciones_precio')
    .select('*, perfiles_usuario!actualizaciones_precio_usuario_id_fkey(nombre_completo)')
    .order('created_at', { ascending: false }).limit(100);
  return dbError ? { error: dbError.message } : { data: data ?? [] };
}

export async function obtenerDetalleActualizacion(id: string) {
  const { supabase, error } = await requireAdmin();
  if (error) return { error };
  const { data, error: dbError } = await supabase.from('actualizaciones_precio_detalle')
    .select('*').eq('actualizacion_id', id).order('concepto').order('tabla');
  return dbError ? { error: dbError.message } : { data: data ?? [] };
}

export async function previsualizarPrecios(input: {
  configuracionIds: string[]; tipo: 'porcentaje' | 'monto_fijo'; valor: number;
  redondeo: number; conceptos: string[]; incluirInactivas: boolean;
}) {
  const { supabase, error } = await requireAdmin();
  if (error) return { error };
  const { data, error: dbError } = await supabase.rpc('previsualizar_actualizacion_precios', {
    p_configuracion_ids: input.configuracionIds, p_tipo_ajuste: input.tipo, p_valor: input.valor,
    p_redondeo: input.redondeo, p_conceptos: input.conceptos, p_incluir_inactivas: input.incluirInactivas,
  });
  return dbError ? { error: dbError.message } : { data };
}

export async function aplicarPrecios(input: {
  configuracionIds: string[]; tipo: 'porcentaje' | 'monto_fijo'; valor: number;
  redondeo: number; conceptos: string[]; incluirInactivas: boolean; nota: string;
}) {
  const { supabase, error } = await requireAdmin();
  if (error) return { error };
  const { data, error: dbError } = await supabase.rpc('aplicar_actualizacion_precios', {
    p_configuracion_ids: input.configuracionIds, p_tipo_ajuste: input.tipo, p_valor: input.valor,
    p_redondeo: input.redondeo, p_conceptos: input.conceptos, p_nota: input.nota,
    p_incluir_inactivas: input.incluirInactivas,
  });
  return dbError ? { error: dbError.message } : { data };
}

export async function revertirPrecios(id: string) {
  const { supabase, error } = await requireAdmin();
  if (error) return { error };
  const { data, error: dbError } = await supabase.rpc('revertir_actualizacion_precios', { p_actualizacion_id: id });
  return dbError ? { error: dbError.message } : { data };
}
