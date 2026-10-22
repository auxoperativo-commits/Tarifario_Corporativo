'use server';

import { createClient } from '@/lib/supabase/server';

async function clienteAutenticado() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, error: 'La sesión expiró.' };
  return { supabase, error: null };
}

export type FiltrosHistorico = {
  transportes: string[]; desde: string; hasta: string; origen: string; destino: string;
  conceptos: string[]; tipos: string[]; umbral: number;
};

function registrarMedicion(capa: string, inicio: number, data: unknown) {
  const kb = new TextEncoder().encode(JSON.stringify(data ?? null)).byteLength / 1024;
  console.info(`[historico-precios] ${capa} servidor ${(performance.now() - inicio).toFixed(0)} ms · ${kb.toFixed(1)} KB`);
}

export async function cargarResumenHistorico(f: FiltrosHistorico) {
  const { supabase, error } = await clienteAutenticado();
  if (error) return { error };
  const inicio = performance.now();
  const { data, error: dbError } = await supabase.rpc('historial_precios_matriz_resumen', {
    p_transportes: f.transportes, p_desde: f.desde, p_hasta: f.hasta,
    p_origen: f.origen || null, p_destino: f.destino || null,
    p_conceptos: f.conceptos, p_tipos: f.tipos, p_umbral: f.umbral,
  });
  if (dbError) return { error: dbError.message };
  registrarMedicion('capa 1', inicio, data);
  return { data };
}

export async function cargarRutasHistorico(f: FiltrosHistorico, transporte: string) {
  const { supabase, error } = await clienteAutenticado();
  if (error) return { error };
  const inicio = performance.now();
  const { data, error: dbError } = await supabase.rpc('historial_precios_matriz_rutas', {
    p_transportes: f.transportes, p_transporte: transporte, p_desde: f.desde, p_hasta: f.hasta,
    p_origen: f.origen || null, p_destino: f.destino || null,
    p_conceptos: f.conceptos, p_tipos: f.tipos, p_umbral: f.umbral,
  });
  if (dbError) return { error: dbError.message };
  registrarMedicion('capa 2', inicio, data);
  return { data };
}

export async function cargarPreciosHistorico(f: FiltrosHistorico, transporte: string, configuracion: string) {
  const { supabase, error } = await clienteAutenticado();
  if (error) return { error };
  const inicio = performance.now();
  const { data, error: dbError } = await supabase.rpc('historial_precios_matriz_precios', {
    p_transportes: f.transportes, p_transporte: transporte, p_configuracion: configuracion,
    p_desde: f.desde, p_hasta: f.hasta, p_origen: f.origen || null, p_destino: f.destino || null,
    p_conceptos: f.conceptos, p_tipos: f.tipos,
  });
  if (dbError) return { error: dbError.message };
  registrarMedicion('capa 3', inicio, data);
  return { data };
}

export async function buscarTransportesHistorico(busqueda: string) {
  const { supabase, error } = await clienteAutenticado();
  if (error) return { error };
  const { data, error: dbError } = await supabase.rpc('buscar_transportes_historial', { p_busqueda: busqueda });
  return dbError ? { error: dbError.message } : { data: data ?? [] };
}
