'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';
import { puedeEditar } from '@/components/layout/AppShell';
import { useToast } from '@/hooks/use-toast';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import { EmptyState } from '@/components/layout/EmptyState';
import { formatearPrecio, normalizarUbicacion } from '@/lib/calculos/envios';
import { ImportarConfiguracionDialog } from './ImportarConfiguracionDialog';
import type {
  Transporte, Tag, ConfiguracionEnvio,
  TarifaBulto, TarifaPallet, TarifaKg, TagPrecio, UbicacionSeleccionada, UbicacionPersonalizada,
} from '@/lib/types/database';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus, Pencil, Trash2, Settings, Clock, Package, Truck, Loader2, X, ChevronDown, ChevronUp, Upload, Search, Weight,
} from 'lucide-react';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface TramoForm {
  id?: string;
  desde: number | '';
  precio: number | '';
  esValorInicial?: boolean; // solo aplica al tramo con desde = 1
}

interface ConfiguracionConRelaciones extends ConfiguracionEnvio {
  tarifas_bulto: TarifaBulto[];
  tarifas_pallet?: TarifaPallet[];
  tarifas_kg?: TarifaKg[];
  configuracion_tags: { tag_id: string; configuracion_tag_precios?: TagPrecio[] }[];
  configuracion_tag_precios?: TagPrecio[];
}

interface FormData {
  origen: UbicacionSeleccionada | null;
  destino: UbicacionSeleccionada | null;
  tiempo_min: number | '';
  tiempo_max: number | '';
  precio_camion: number | '';
  activo: boolean;
  aptoPeritoneal: boolean;
  tramosBulto: TramoForm[];
  tramosPallet: TramoForm[];
  tramosKg: TramoForm[];
  tagIds: string[];
  // Precios adicionales por tag: clave = tag_id, valor = precios opcionales por unidad
  tagPrecios: Record<string, {
    bulto: number | '';
    pallet: number | '';
    kg: number | '';
    camion_completo: number | '';
  }>;
}

type EstadoActualizacion = 'vigente' | 'atencion' | 'desactualizado';

function fechaMasReciente(fechas: Array<string | null | undefined>): string | null {
  const validas = fechas.filter((fecha): fecha is string => Boolean(fecha));
  if (!validas.length) return null;
  return validas.reduce((ultima, fecha) => new Date(fecha) > new Date(ultima) ? fecha : ultima);
}

function estadoActualizacion(fecha: string | null): EstadoActualizacion {
  if (!fecha) return 'desactualizado';
  const dias = (Date.now() - new Date(fecha).getTime()) / 86400000;
  if (dias <= 30) return 'vigente';
  if (dias <= 60) return 'atencion';
  return 'desactualizado';
}

function formatearFechaActualizacion(fecha: string | null): string {
  return fecha
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(fecha))
    : 'Sin fecha registrada';
}

function formatearRutaConNombre(
  ubicacion: Partial<UbicacionSeleccionada> | null | undefined,
  fallbackProvincia?: string | null,
  fallbackLocalidad?: string | null,
  customNombre?: string | null
): string {
  const provincia = ubicacion?.provincia ?? fallbackProvincia ?? '';
  const localidad = ubicacion?.localidad ?? fallbackLocalidad ?? '';
  const nombre = ubicacion?.nombre ?? customNombre ?? null;

  if (!provincia) return 'Sin ubicación';
  if (nombre) return `${provincia} (${nombre})${localidad ? ` · ${localidad}` : ''}`;
  if (provincia && localidad) return `${provincia} · ${localidad}`;
  return provincia;
}

const COLORES_ACTUALIZACION: Record<EstadoActualizacion, string> = {
  vigente: 'bg-green-500',
  atencion: 'bg-yellow-400',
  desactualizado: 'bg-red-500',
};

const FORM_VACIO: FormData = {
  origen: null,
  destino: null,
  tiempo_min: '',
  tiempo_max: '',
  precio_camion: '',
  activo: true,
  aptoPeritoneal: false,
  tramosBulto: [{ desde: 1, precio: '', esValorInicial: false }],
  tramosPallet: [{ desde: 1, precio: '' }],
  tramosKg: [{ desde: 1, precio: '' }],
  tagIds: [],
  tagPrecios: {},
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  transportes: Transporte[];
  transportesParaImportar: Transporte[];
  tagsIniciales: Tag[];
  transportePreseleccionadoId: string | null;
  configuracionesIniciales: unknown[];
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ConfiguracionesClient({
  transportes, transportesParaImportar, tagsIniciales, transportePreseleccionadoId, configuracionesIniciales,
}: Props) {
  const { perfil } = useUser();
  const { toast } = useToast();
  const supabase = createClient();
  const editar = puedeEditar(perfil.rol);

  const [transporteId, setTransporteId] = useState(transportePreseleccionadoId ?? '');
  const [configs, setConfigs] = useState<ConfiguracionConRelaciones[]>(
    configuracionesIniciales as ConfiguracionConRelaciones[]
  );
  const [tags, setTags] = useState<Tag[]>(tagsIniciales);
  const [loading, setLoading] = useState(false);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(FORM_VACIO);
  const [saving, setSaving] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [nuevaTagNombre, setNuevaTagNombre] = useState('');
  const [creandoTag, setCreandoTag] = useState(false);
  const [importarOpen, setImportarOpen] = useState(false);
  const [filtroConfiguraciones, setFiltroConfiguraciones] = useState('');
  const [ubicacionesPersonalizadas, setUbicacionesPersonalizadas] = useState<UbicacionPersonalizada[]>([]);
  const [nuevaUbicacion, setNuevaUbicacion] = useState({ nombre: '', provincia: '', localidad: '' });
  const [ubicacionEditandoId, setUbicacionEditandoId] = useState<string | null>(null);
  const [guardandoUbicacion, setGuardandoUbicacion] = useState(false);

  useEffect(() => {
    async function cargarUbicaciones() {
      try {
        const { data } = await supabase.from('ubicaciones_personalizadas').select('*').eq('usuario_id', perfil.id).order('nombre');
        setUbicacionesPersonalizadas((data ?? []) as UbicacionPersonalizada[]);
      } catch {
        setUbicacionesPersonalizadas([]);
      }
    }
    cargarUbicaciones();
  }, [perfil.id, supabase]);

  const cargar = useCallback(async (tid: string) => {
    if (!tid) { setConfigs([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('configuraciones_envio')
      .select(`*, tarifas_bulto(*), tarifas_pallet(*), tarifas_kg(*), configuracion_tags(tag_id), configuracion_tag_precios(*)`)
      .eq('transporte_id', tid)
      .order('created_at', { ascending: false });
    if (error) toast({ variant: 'destructive', title: 'Error al cargar configuraciones.' });
    else setConfigs((data ?? []) as ConfiguracionConRelaciones[]);
    setLoading(false);
  }, [supabase, toast]);

  useEffect(() => {
    if (transporteId && !transportePreseleccionadoId) cargar(transporteId);
  }, [transporteId, transportePreseleccionadoId, cargar]);

  // ── Abrir formulario ──────────────────────────────────────────────────────
  function abrirNuevo() {
    setForm(FORM_VACIO);
    setEditandoId(null);
    setDialogOpen(true);
  }

  function abrirEdicion(c: ConfiguracionConRelaciones) {
    const toTramosBulto = (arr: TarifaBulto[]): TramoForm[] =>
      arr.length > 0
        ? [...arr].sort((a, b) => a.desde_bulto - b.desde_bulto).map((t) => ({
            id: t.id, desde: t.desde_bulto, precio: t.precio,
            esValorInicial: t.es_valor_inicial ?? false,
          }))
        : [{ desde: 1, precio: '', esValorInicial: false }];

    const toTramosPallet = (arr: TarifaPallet[]): TramoForm[] =>
      arr.length > 0
        ? [...arr].sort((a, b) => a.desde_pallet - b.desde_pallet).map((t) => ({
            id: t.id, desde: t.desde_pallet, precio: t.precio,
          }))
        : [{ desde: 1, precio: '' }];

    const toTramosKg = (arr: TarifaKg[]): TramoForm[] =>
      arr.length > 0
        ? [...arr].sort((a, b) => a.desde_kg - b.desde_kg).map((t) => ({
            id: t.id, desde: t.desde_kg, precio: t.precio,
          }))
        : [{ desde: 1, precio: '' }];

    setForm({
      origen: {
        provincia: c.origen_provincia,
        localidad: c.origen_localidad ?? null,
        id: c.origen_ubicacion_personalizada_id ?? undefined,
        nombre: c.origen_nombre_personalizado ?? undefined,
        tipo: c.origen_ubicacion_personalizada_id ? 'personalizada' : 'georef',
      },
      destino: {
        provincia: c.destino_provincia,
        localidad: c.destino_localidad ?? null,
        id: c.destino_ubicacion_personalizada_id ?? undefined,
        nombre: c.destino_nombre_personalizado ?? undefined,
        tipo: c.destino_ubicacion_personalizada_id ? 'personalizada' : 'georef',
      },
      tiempo_min: c.tiempo_estimado_min_horas ?? '',
      tiempo_max: c.tiempo_estimado_max_horas ?? '',
      precio_camion: c.precio_camion_completo ?? '',
      activo: c.activo,
      aptoPeritoneal: c.apto_peritoneal ?? false,
      tramosBulto: toTramosBulto(c.tarifas_bulto),
      tramosPallet: toTramosPallet(c.tarifas_pallet ?? []),
      tramosKg: toTramosKg(c.tarifas_kg ?? []),
      tagIds: c.configuracion_tags.map((ct) => ct.tag_id),
      // Cargar precios de tag existentes en el formulario
      tagPrecios: Object.fromEntries(
        (c.configuracion_tag_precios && c.configuracion_tag_precios.length > 0
          ? c.configuracion_tag_precios
          : c.configuracion_tags.flatMap((ct) => ct.configuracion_tag_precios ?? [])
        ).map((p) => [
          p.tag_id,
          {
            bulto: p.precio_bulto ?? '',
            pallet: p.precio_pallet ?? '',
            kg: p.precio_kg ?? '',
            camion_completo: p.precio_camion_completo ?? '',
          },
        ])
      ),
    });
    setEditandoId(c.id);
    setDialogOpen(true);
  }

  // ── Tramos genérico ───────────────────────────────────────────────────────
  function addTramo(campo: 'tramosBulto' | 'tramosPallet' | 'tramosKg') {
    setForm((f) => ({ ...f, [campo]: [...f[campo], { desde: '', precio: '' }] }));
  }

  function updTramo(campo: 'tramosBulto' | 'tramosPallet' | 'tramosKg', idx: number, k: 'desde' | 'precio', v: string) {
    setForm((f) => {
      const arr = [...f[campo]];
      arr[idx] = { ...arr[idx], [k]: v === '' ? '' : Number(v) };
      return { ...f, [campo]: arr };
    });
  }

  function delTramo(campo: 'tramosBulto' | 'tramosPallet' | 'tramosKg', idx: number) {
    setForm((f) => ({ ...f, [campo]: f[campo].filter((_, i) => i !== idx) }));
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  function toggleTag(id: string) {
    setForm((f) => {
      const seleccionado = f.tagIds.includes(id);
      const nuevosTagIds = seleccionado ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id];
      const nuevosTagPrecios = { ...f.tagPrecios };
      if (!seleccionado) {
        // Inicializar entrada de precios vacía para el tag recién seleccionado
        if (!nuevosTagPrecios[id]) {
          nuevosTagPrecios[id] = { bulto: '', pallet: '', kg: '', camion_completo: '' };
        }
      } else {
        // Limpiar los precios del tag deseleccionado
        delete nuevosTagPrecios[id];
      }
      return { ...f, tagIds: nuevosTagIds, tagPrecios: nuevosTagPrecios };
    });
  }

  async function crearTag() {
    if (!nuevaTagNombre.trim()) return;
    setCreandoTag(true);
    const { data, error } = await supabase.from('tags')
      .insert({ nombre: nuevaTagNombre.trim(), color: '#6b7280' })
      .select().single();
    setCreandoTag(false);
    if (error) { toast({ variant: 'destructive', title: 'Error al crear tag.' }); return; }
    setTags((prev) => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setForm((f) => ({
      ...f,
      tagIds: [...f.tagIds, data.id],
      tagPrecios: { ...f.tagPrecios, [data.id]: { bulto: '', pallet: '', kg: '', camion_completo: '' } },
    }));
    setNuevaTagNombre('');
  }

  // ── Validar ───────────────────────────────────────────────────────────────
  function validar(): string | null {
    if (!form.origen?.provincia) return 'Seleccioná el origen.';
    if (!form.destino?.provincia) return 'Seleccioná el destino.';
    if (form.tiempo_min === '' || form.tiempo_max === '') return 'El tiempo estimado mínimo y máximo son obligatorios.';
    if (Number(form.tiempo_min) < 0 || Number(form.tiempo_max) < 0) return 'El tiempo estimado no puede ser negativo.';
    if (Number(form.tiempo_min) > Number(form.tiempo_max)) return 'El tiempo mínimo no puede ser mayor al máximo.';

    for (const [campo, label] of [['tramosBulto', 'bulto'], ['tramosPallet', 'pallet'], ['tramosKg', 'kg']] as const) {
      const filled = form[campo].filter((t) => t.desde !== '' && t.precio !== '');
      const desdes = filled.map((t) => t.desde);
      if (new Set(desdes).size !== desdes.length) return `Hay valores "desde ${label}" repetidos.`;
      if (filled.some((t) => Number(t.desde) <= 0)) return `"Desde ${label}" debe ser mayor a 0.`;
    }
    return null;
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  async function guardar() {
    const err = validar();
    if (err) { toast({ variant: 'destructive', title: err }); return; }
    setSaving(true);
    try {
      const fechaActualizacion = new Date().toISOString();
      const payload = {
        transporte_id: transporteId,
        origen_provincia: form.origen!.provincia,
        origen_localidad: form.origen!.localidad ?? null,
        origen_nombre_personalizado: form.origen?.tipo === 'personalizada' ? form.origen.nombre ?? form.origen.provincia : null,
        origen_ubicacion_personalizada_id: form.origen?.tipo === 'personalizada' ? form.origen.id ?? null : null,
        destino_provincia: form.destino!.provincia,
        destino_localidad: form.destino!.localidad ?? null,
        destino_nombre_personalizado: form.destino?.tipo === 'personalizada' ? form.destino.nombre ?? form.destino.provincia : null,
        destino_ubicacion_personalizada_id: form.destino?.tipo === 'personalizada' ? form.destino.id ?? null : null,
        tiempo_estimado_min_horas: form.tiempo_min !== '' ? Number(form.tiempo_min) : null,
        tiempo_estimado_max_horas: form.tiempo_max !== '' ? Number(form.tiempo_max) : null,
        precio_pallet: null,
        precio_camion_completo: form.precio_camion !== '' ? Number(form.precio_camion) : null,
        precio_camion_actualizado_at: form.precio_camion !== '' ? fechaActualizacion : null,
        apto_peritoneal: form.aptoPeritoneal,
        activo: form.activo,
      };

      let configId: string;
      if (editandoId) {
        const { error } = await supabase.from('configuraciones_envio')
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editandoId);
        if (error) throw error;
        configId = editandoId;
      } else {
        const { data, error } = await supabase.from('configuraciones_envio')
          .insert(payload).select().single();
        if (error) throw error;
        configId = data.id;
      }

      // tarifas_bulto (con es_valor_inicial)
      await supabase.from('tarifas_bulto').delete().eq('configuracion_id', configId);
      const bultosFilled = form.tramosBulto.filter((t) => t.desde !== '' && t.precio !== '');
      if (bultosFilled.length > 0) {
        const { error } = await supabase.from('tarifas_bulto').insert(
          bultosFilled.map((t) => ({
            configuracion_id: configId,
            desde_bulto: Number(t.desde),
            precio: Number(t.precio),
            es_valor_inicial: t.esValorInicial ?? false,
            updated_at: fechaActualizacion,
          }))
        );
        if (error) throw error;
      }

      // tarifas_pallet (solo si la tabla existe — migración 01_tarifas_pallet.sql)
      try {
        await supabase.from('tarifas_pallet').delete().eq('configuracion_id', configId);
        const palletsFilled = form.tramosPallet.filter((t) => t.desde !== '' && t.precio !== '');
        if (palletsFilled.length > 0) {
          await supabase.from('tarifas_pallet').insert(
            palletsFilled.map((t) => ({ configuracion_id: configId, desde_pallet: Number(t.desde), precio: Number(t.precio), updated_at: fechaActualizacion }))
          );
        }
      } catch {
        console.warn('tarifas_pallet no encontrada. Ejecutar supabase/migrations/01_tarifas_pallet.sql');
      }

      // tarifas_kg
      try {
        await supabase.from('tarifas_kg').delete().eq('configuracion_id', configId);
        const kgFilled = form.tramosKg.filter((t) => t.desde !== '' && t.precio !== '');
        if (kgFilled.length > 0) {
          await supabase.from('tarifas_kg').insert(
            kgFilled.map((t) => ({ configuracion_id: configId, desde_kg: Number(t.desde), precio: Number(t.precio), updated_at: fechaActualizacion }))
          );
        }
      } catch {
        console.warn('tarifas_kg no encontrada. Ejecutar supabase/migrations/06_tarifas_kg.sql');
      }

      // tags + precios de tag
      await supabase.from('configuracion_tags').delete().eq('configuracion_id', configId);
      // Borrar precios de tag anteriores de esta configuración
      try { await supabase.from('configuracion_tag_precios').delete().eq('configuracion_id', configId); } catch { /* tabla opcional */ }
      if (form.tagIds.length > 0) {
        await supabase.from('configuracion_tags').insert(
          form.tagIds.map((tag_id) => ({ configuracion_id: configId, tag_id }))
        );
        // Guardar precios de tag (solo los que tienen al menos un precio definido)
        const tagPreciosParaGuardar = form.tagIds
          .map((tag_id) => {
            const precios = form.tagPrecios[tag_id];
            if (!precios) return null;
            const pBulto = precios.bulto !== '' ? Number(precios.bulto) : null;
            const pPallet = precios.pallet !== '' ? Number(precios.pallet) : null;
            const pKg = precios.kg !== '' ? Number(precios.kg) : null;
            const pCamion = precios.camion_completo !== '' ? Number(precios.camion_completo) : null;
            // Solo guardar si al menos un precio está definido
            if (pBulto === null && pPallet === null && pKg === null && pCamion === null) return null;
            return {
              configuracion_id: configId,
              tag_id,
              precio_bulto: pBulto,
              precio_pallet: pPallet,
              precio_kg: pKg,
              precio_camion_completo: pCamion,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
        if (tagPreciosParaGuardar.length > 0) {
          try {
            await supabase.from('configuracion_tag_precios').insert(tagPreciosParaGuardar);
          } catch {
            console.warn('configuracion_tag_precios no encontrada. Ejecutar supabase/migrations/07_tag_precios.sql');
          }
        }
      }

      toast({ title: editandoId ? 'Configuración actualizada.' : 'Configuración creada.' });
      setDialogOpen(false);
      await cargar(transporteId);
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e instanceof Error ? e.message : 'Error inesperado' });
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(id: string) {
    const { error } = await supabase.from('configuraciones_envio').delete().eq('id', id);
    if (error) { toast({ variant: 'destructive', title: 'Error al eliminar.' }); return; }
    setConfigs((p) => p.filter((c) => c.id !== id));
    setEliminandoId(null);
    toast({ title: 'Configuración eliminada.' });
  }

  async function toggleActivo(c: ConfiguracionConRelaciones) {
    const { error } = await supabase.from('configuraciones_envio')
      .update({ activo: !c.activo, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast({ variant: 'destructive', title: 'Error.' }); return; }
    setConfigs((p) => p.map((x) => x.id === c.id ? { ...x, activo: !x.activo } : x));
  }

  const getTag = (id: string) => tags.find((t) => t.id === id);
  const transporteActual = transportes.find((t) => t.id === transporteId);
  const configsFiltradas = useMemo(() => {
    const texto = normalizarUbicacion(filtroConfiguraciones);
    if (!texto) return configs;
    return configs.filter((config) => [config.origen_provincia, config.origen_localidad, config.destino_provincia, config.destino_localidad]
      .some((valor) => normalizarUbicacion(valor).includes(texto)));
  }, [configs, filtroConfiguraciones]);

  async function finalizarImportacion(tid: string) {
    setTransporteId(tid);
    await cargar(tid);
  }

  async function guardarUbicacionPersonalizada() {
    if (!nuevaUbicacion.nombre.trim() || !nuevaUbicacion.provincia.trim()) {
      toast({ variant: 'destructive', title: 'Completá nombre y provincia.' });
      return;
    }

    setGuardandoUbicacion(true);
    try {
      if (ubicacionEditandoId) {
        const { data, error } = await supabase.from('ubicaciones_personalizadas')
          .update({
            nombre: nuevaUbicacion.nombre.trim(),
            provincia: nuevaUbicacion.provincia.trim(),
            localidad: nuevaUbicacion.localidad.trim() || null,
          })
          .eq('id', ubicacionEditandoId)
          .select().single();
        if (error) throw error;
        setUbicacionesPersonalizadas((prev) => prev.map((item) => item.id === data.id ? data as UbicacionPersonalizada : item));
        toast({ title: 'Ubicación personalizada actualizada.' });
      } else {
        const { data, error } = await supabase.from('ubicaciones_personalizadas').insert({
          usuario_id: perfil.id,
          nombre: nuevaUbicacion.nombre.trim(),
          provincia: nuevaUbicacion.provincia.trim(),
          localidad: nuevaUbicacion.localidad.trim() || null,
        }).select().single();
        if (error) throw error;
        setUbicacionesPersonalizadas((prev) => [...prev, data as UbicacionPersonalizada]);
        toast({ title: 'Ubicación personalizada creada.' });
      }
      setNuevaUbicacion({ nombre: '', provincia: '', localidad: '' });
      setUbicacionEditandoId(null);
    } catch {
      toast({ variant: 'destructive', title: ubicacionEditandoId ? 'No se pudo actualizar la ubicación.' : 'No se pudo crear la ubicación.' });
    } finally {
      setGuardandoUbicacion(false);
    }
  }

  async function eliminarUbicacionPersonalizada(id: string) {
    const { error } = await supabase.from('ubicaciones_personalizadas').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo eliminar la ubicación.' });
      return;
    }
    setUbicacionesPersonalizadas((prev) => prev.filter((item) => item.id !== id));
    if (ubicacionEditandoId === id) {
      setUbicacionEditandoId(null);
      setNuevaUbicacion({ nombre: '', provincia: '', localidad: '' });
    }
    toast({ title: 'Ubicación personalizada eliminada.' });
  }

  function editarUbicacionPersonalizada(item: UbicacionPersonalizada) {
    setUbicacionEditandoId(item.id);
    setNuevaUbicacion({ nombre: item.nombre, provincia: item.provincia, localidad: item.localidad ?? '' });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Selector transporte */}
      <div className="bg-white border rounded-xl p-4 mb-6">
        <Label className="text-sm font-medium mb-2 block">Transporte</Label>
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={transporteId} onValueChange={(v) => { setTransporteId(v); cargar(v); }}>
            <SelectTrigger className="sm:max-w-sm">
              <SelectValue placeholder="Seleccionar transporte..." />
            </SelectTrigger>
            <SelectContent>
              {transportes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nombre_fantasia || t.razon_social}{t.nombre_fantasia ? ` · ${t.razon_social}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {transporteId && editar && <Button onClick={abrirNuevo} className="shrink-0"><Plus className="mr-2 h-4 w-4" />Agregar configuración</Button>}
          {editar && <Button variant="outline" onClick={() => setImportarOpen(true)} className="shrink-0"><Upload className="mr-2 h-4 w-4" />Importar configuración</Button>}
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Crear ubicación</p>
            <p className="text-xs text-muted-foreground">Usá rutas personalizadas para destinos no georreferenciados.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
          <Input value={nuevaUbicacion.nombre} onChange={(event) => setNuevaUbicacion((prev) => ({ ...prev, nombre: event.target.value }))} placeholder="Nombre de la ubicación" />
          <Input value={nuevaUbicacion.provincia} onChange={(event) => setNuevaUbicacion((prev) => ({ ...prev, provincia: event.target.value }))} placeholder="Provincia" />
          <Input value={nuevaUbicacion.localidad} onChange={(event) => setNuevaUbicacion((prev) => ({ ...prev, localidad: event.target.value }))} placeholder="Localidad (opcional)" />
          <div className="flex gap-2">
            <Button onClick={guardarUbicacionPersonalizada} disabled={guardandoUbicacion} variant="outline" className="flex-1">
              {guardandoUbicacion ? <Loader2 className="h-4 w-4 animate-spin" /> : ubicacionEditandoId ? 'Actualizar' : 'Guardar'}
            </Button>
            {ubicacionEditandoId && (
              <Button variant="ghost" onClick={() => { setUbicacionEditandoId(null); setNuevaUbicacion({ nombre: '', provincia: '', localidad: '' }); }} className="px-2">
                Cancelar
              </Button>
            )}
          </div>
        </div>
        {ubicacionesPersonalizadas.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ubicacionesPersonalizadas.map((ubicacion) => (
              <span key={ubicacion.id} className="inline-flex items-center gap-2 rounded-full border bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                <span>{ubicacion.provincia} ({ubicacion.nombre}){ubicacion.localidad ? ` · ${ubicacion.localidad}` : ''}</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => editarUbicacionPersonalizada(ubicacion)} className="text-slate-500 hover:text-slate-700" aria-label={`Editar ${ubicacion.nombre}`}>
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => eliminarUbicacionPersonalizada(ubicacion.id)} className="text-red-500 hover:text-red-700" aria-label={`Eliminar ${ubicacion.nombre}`}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Lista */}
      {!transporteId ? (
        <EmptyState icon={Settings} title="Seleccioná un transporte" description="Elegí un transporte para ver sus configuraciones." />
      ) : loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : configs.length === 0 ? (
        <EmptyState icon={Settings} title="Sin configuraciones"
          description={`${transporteActual?.nombre_fantasia || transporteActual?.razon_social} no tiene configuraciones de envío.`}
          action={editar ? <Button onClick={abrirNuevo}><Plus className="mr-2 h-4 w-4" />Agregar configuración</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filtroConfiguraciones} onChange={(event) => setFiltroConfiguraciones(event.target.value)} placeholder="Buscar por provincia o localidad..." className="pl-9 bg-white" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium">Estado de precios:</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-500" />Vigente (hasta 30 días)</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />Atención (31–60 días)</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Desactualizado (más de 60 días)</span>
          </div>
          {configsFiltradas.length === 0 ? <p className="rounded-lg border bg-white p-5 text-sm text-muted-foreground">No hay configuraciones que coincidan con la búsqueda.</p> : configsFiltradas.map((c) => {
            const tagsDeLaConfig = c.configuracion_tags.map((ct) => getTag(ct.tag_id)).filter(Boolean) as Tag[];
            const exp = expandidas.has(c.id);
            const ultimaActualizacion = fechaMasReciente([
              c.updated_at,
              c.precio_camion_actualizado_at,
              ...c.tarifas_bulto.map((tarifa) => tarifa.updated_at),
              ...(c.tarifas_pallet ?? []).map((tarifa) => tarifa.updated_at),
              ...(c.tarifas_kg ?? []).map((tarifa) => tarifa.updated_at),
            ]);
            const estado = estadoActualizacion(ultimaActualizacion);
            return (
              <div key={c.id} className="bg-white border rounded-xl overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800 text-sm">
                        {formatearRutaConNombre(
                          { provincia: c.origen_provincia, localidad: c.origen_localidad ?? null, nombre: c.origen_nombre_personalizado ?? undefined },
                          c.origen_provincia,
                          c.origen_localidad ?? null,
                          c.origen_nombre_personalizado
                        )}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-semibold text-slate-800 text-sm">
                        {formatearRutaConNombre(
                          { provincia: c.destino_provincia, localidad: c.destino_localidad ?? null, nombre: c.destino_nombre_personalizado ?? undefined },
                          c.destino_provincia,
                          c.destino_localidad ?? null,
                          c.destino_nombre_personalizado
                        )}
                      </span>
                      <Badge variant={c.activo ? 'default' : 'secondary'} className="text-xs">
                        {c.activo ? 'Activa' : 'Inactiva'}
                      </Badge>
                        <span className={`h-3 w-3 rounded-full ${COLORES_ACTUALIZACION[estado]}`} title={`Última actualización: ${formatearFechaActualizacion(ultimaActualizacion)}`} aria-label={`Última actualización: ${formatearFechaActualizacion(ultimaActualizacion)}`} />
                      {c.apto_peritoneal && (
                        <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 bg-blue-50">
                          Apto peritoneal
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Actualizada: {formatearFechaActualizacion(ultimaActualizacion)}</span>
                      {c.tarifas_bulto.length > 0 && (
                        <span className="flex items-center gap-1"><Package className="h-3.5 w-3.5" />{c.tarifas_bulto.length} tramo{c.tarifas_bulto.length > 1 ? 's' : ''} bultos</span>
                      )}
      {(c.tarifas_pallet ?? []).length > 0 && (
                        <span className="flex items-center gap-1"><span className="font-bold text-xs">P</span>{(c.tarifas_pallet ?? []).length} tramo{(c.tarifas_pallet ?? []).length > 1 ? 's' : ''} pallets</span>
                      )}
                      {c.precio_camion_completo !== null && (
                        <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" />{formatearPrecio(c.precio_camion_completo)} /camión</span>
                      )}
                      {(c.tiempo_estimado_min_horas || c.tiempo_estimado_max_horas) && (
                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{c.tiempo_estimado_min_horas ?? '?'}–{c.tiempo_estimado_max_horas ?? '?'} hs</span>
                      )}
                    </div>
                    {tagsDeLaConfig.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {tagsDeLaConfig.map((tag) => (
                          <span key={tag.id} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.nombre}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setExpandidas((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                      className="text-xs text-muted-foreground hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100">
                      {exp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}Detalle
                    </button>
                    {editar && (
                      <>
                        <Switch checked={c.activo} onCheckedChange={() => toggleActivo(c)} aria-label="Activo/Inactivo" />
                        <Button variant="outline" size="sm" onClick={() => abrirEdicion(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="outline" size="sm" onClick={() => setEliminandoId(c.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                  </div>
                </div>

                {exp && (
                  <div className="border-t px-4 py-3 bg-slate-50 space-y-3">
                    {c.tarifas_bulto.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Tramos bulto</p>
                        {[...c.tarifas_bulto].sort((a, b) => a.desde_bulto - b.desde_bulto).map((t, i, arr) => (
                          <div key={t.id} className="flex gap-2 text-sm">
                            <span className="text-muted-foreground w-44">
                              {i === arr.length - 1 ? `Bulto ${t.desde_bulto} en adelante` : `Bulto ${t.desde_bulto}–${arr[i + 1].desde_bulto - 1}`}
                            </span>
                            <span className="font-semibold">{formatearPrecio(t.precio)}</span>
                            <span className="text-xs text-muted-foreground">Actualizado: {formatearFechaActualizacion(t.updated_at ?? c.updated_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(c.tarifas_pallet ?? []).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Tramos pallet</p>
                        {[...(c.tarifas_pallet ?? [])].sort((a, b) => a.desde_pallet - b.desde_pallet).map((t, i, arr) => (
                          <div key={t.id} className="flex gap-2 text-sm">
                            <span className="text-muted-foreground w-44">
                              {i === arr.length - 1
                                ? `Desde ${t.desde_pallet} pallet${t.desde_pallet !== 1 ? 's' : ''} en adelante`
                                : `${t.desde_pallet}–${arr[i + 1].desde_pallet} pallets`}
                            </span>
                            <span className="font-semibold">{formatearPrecio(t.precio)}</span>
                            <span className="text-xs text-muted-foreground">Actualizado: {formatearFechaActualizacion(t.updated_at ?? c.updated_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(c.tarifas_kg ?? []).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Tramos kg</p>
                        {[...(c.tarifas_kg ?? [])].sort((a, b) => a.desde_kg - b.desde_kg).map((t, i, arr) => (
                          <div key={t.id} className="flex gap-2 text-sm">
                            <span className="text-muted-foreground w-44">
                              {i === arr.length - 1
                                ? `Desde ${t.desde_kg} kg en adelante`
                                : `${t.desde_kg}–${arr[i + 1].desde_kg} kg`}
                            </span>
                            <span className="font-semibold">{formatearPrecio(t.precio)}</span>
                            <span className="text-xs text-muted-foreground">Actualizado: {formatearFechaActualizacion(t.updated_at ?? c.updated_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.precio_camion_completo !== null && (
                      <div className="flex gap-2 text-sm"><span className="text-muted-foreground w-44">Camión completo</span><span className="font-semibold">{formatearPrecio(c.precio_camion_completo)}</span><span className="text-xs text-muted-foreground">Actualizado: {formatearFechaActualizacion(c.precio_camion_actualizado_at ?? c.updated_at)}</span></div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialog ───────────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editandoId ? 'Editar configuración' : 'Nueva configuración de envío'}</DialogTitle>
            <DialogDescription>{transporteActual?.nombre_fantasia || transporteActual?.razon_social} · Ruta, tiempos y precios.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Origen / Destino */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <GeorefCombobox label="Origen" value={form.origen} onChange={(v) => setForm((f) => ({ ...f, origen: v }))} localidadOpcional />
                {ubicacionesPersonalizadas.length > 0 && (
                  <Select value="" onValueChange={(value) => {
                    const ubicacion = ubicacionesPersonalizadas.find((item) => item.id === value);
                    if (!ubicacion) return;
                    setForm((f) => ({ ...f, origen: { provincia: ubicacion.provincia, localidad: ubicacion.localidad ?? null, nombre: ubicacion.nombre, tipo: 'personalizada' } }));
                  }}>
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="Usar ubicación personalizada como origen" />
                    </SelectTrigger>
                    <SelectContent>
                      {ubicacionesPersonalizadas.map((ubicacion) => (
                        <SelectItem key={ubicacion.id} value={ubicacion.id}>{ubicacion.provincia} ({ubicacion.nombre}){ubicacion.localidad ? ` · ${ubicacion.localidad}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <GeorefCombobox label="Destino" value={form.destino} onChange={(v) => setForm((f) => ({ ...f, destino: v }))} localidadOpcional />
                {ubicacionesPersonalizadas.length > 0 && (
                  <Select value="" onValueChange={(value) => {
                    const ubicacion = ubicacionesPersonalizadas.find((item) => item.id === value);
                    if (!ubicacion) return;
                    setForm((f) => ({ ...f, destino: { provincia: ubicacion.provincia, localidad: ubicacion.localidad ?? null, nombre: ubicacion.nombre, tipo: 'personalizada' } }));
                  }}>
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="Usar ubicación personalizada como destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {ubicacionesPersonalizadas.map((ubicacion) => (
                        <SelectItem key={ubicacion.id} value={ubicacion.id}>{ubicacion.provincia} ({ubicacion.nombre}){ubicacion.localidad ? ` · ${ubicacion.localidad}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <Separator />

            {/* Tiempo */}
            <div>
              <Label className="flex items-center gap-1.5 mb-3"><Clock className="h-3.5 w-3.5 text-muted-foreground" />Tiempo estimado</Label>
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Mínimo (hs)</Label>
                  <Input type="number" min={0} placeholder="12" value={form.tiempo_min}
                    onChange={(e) => setForm((f) => ({ ...f, tiempo_min: e.target.value === '' ? '' : Number(e.target.value) }))} />
                </div>
                <span className="mt-5 text-muted-foreground">–</span>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Máximo (hs)</Label>
                  <Input type="number" min={0} placeholder="24" value={form.tiempo_max}
                    onChange={(e) => setForm((f) => ({ ...f, tiempo_max: e.target.value === '' ? '' : Number(e.target.value) }))} />
                </div>
              </div>
            </div>

            <Separator />

            {/* Tramos bulto */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-muted-foreground" />Precio por bulto (tramos)</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => addTramo('tramosBulto')}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Agregar tramo
                </Button>
              </div>
              <div className="space-y-2">
                {form.tramosBulto.map((tramo, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="w-36 space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Desde bulto Nº</Label>}
                      <Input type="number" min={idx === 0 ? 1 : 2} step={1} placeholder={String(idx + 1)}
                        value={tramo.desde} onChange={(e) => updTramo('tramosBulto', idx, 'desde', e.target.value)} />
                    </div>
                    <div className="flex-1 space-y-1">
                      {idx === 0 && <Label className="text-xs text-muted-foreground">Precio por bulto ($)</Label>}
                      <Input type="number" min={0} placeholder="18000"
                        value={tramo.precio} onChange={(e) => updTramo('tramosBulto', idx, 'precio', e.target.value)} />
                    </div>
                    {/* Checkbox "Valor inicial" solo en el tramo 1 */}
                    {idx === 0 && (
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Valor inicial</Label>
                        <button
                          type="button"
                          onClick={() => setForm((f) => {
                            const arr = [...f.tramosBulto];
                            arr[0] = { ...arr[0], esValorInicial: !arr[0].esValorInicial };
                            return { ...f, tramosBulto: arr };
                          })}
                          className={`h-8 w-8 rounded border-2 flex items-center justify-center transition-colors ${tramo.esValorInicial ? 'bg-primary border-primary' : 'border-slate-300 hover:border-slate-400'}`}
                          aria-pressed={!!tramo.esValorInicial}
                          title="Si está marcado, el precio del bulto 1 se cobra siempre y los demás se calculan al precio del tramo vigente"
                        >
                          {tramo.esValorInicial && <span className="text-white text-xs font-bold">✓</span>}
                        </button>
                      </div>
                    )}
                    {form.tramosBulto.length > 1 && (
                      <button type="button" onClick={() => delTramo('tramosBulto', idx)}
                        className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors mb-0.5" aria-label="Eliminar tramo">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {/* Explicación según modo */}
              {form.tramosBulto[0]?.esValorInicial ? (
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mt-2 border border-amber-200">
                  <strong>Modo valor inicial:</strong> el bulto 1 siempre se cobra al precio indicado. Los demás bultos se calculan al precio del tramo vigente según la cantidad total.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2">
                  Toda la cantidad se multiplica por el precio del tramo vigente (el mayor &quot;desde bulto&quot; que sea ≤ a la cantidad).
                </p>
              )}
            </div>

            <Separator />

            {/* Tramos pallet */}
            <TramoSection
              label="Precio por pallet (tramos)"
              icon={<span className="text-xs font-bold bg-slate-200 text-slate-600 rounded px-1">P</span>}
              tramos={form.tramosPallet}
              unidad="pallet"
              paso={0.5}
              onAdd={() => addTramo('tramosPallet')}
              onUpdate={(i, k, v) => updTramo('tramosPallet', i, k, v)}
              onDelete={(i) => delTramo('tramosPallet', i)}
              hint="Soporta medios pallets (0.5). Ej: desde 1 → $90.000, desde 2 → $70.000."
            />

            <Separator />

            <TramoSection
              label="Precio por kg (tramos)"
              icon={<Weight className="h-3.5 w-3.5 text-muted-foreground" />}
              tramos={form.tramosKg}
              unidad="kg"
              paso={1}
              onAdd={() => addTramo('tramosKg')}
              onUpdate={(i, k, v) => updTramo('tramosKg', i, k, v)}
              onDelete={(i) => delTramo('tramosKg', i)}
              hint="Cada tramo representa el precio total para ese rango de kg. Ej: desde 5 kg → $10.000, desde 10 kg → $19.000."
            />

            <Separator />

            {/* Camión completo */}
            <div className="space-y-1.5">
              <Label htmlFor="precio-camion" className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-muted-foreground" />Precio camión completo ($)
              </Label>
              <Input id="precio-camion" type="number" min={0} placeholder="450000" value={form.precio_camion}
                onChange={(e) => setForm((f) => ({ ...f, precio_camion: e.target.value === '' ? '' : Number(e.target.value) }))} />
              <p className="text-xs text-muted-foreground">Precio fijo por viaje completo. Dejá vacío si no aplica.</p>
            </div>

            <Separator />

            {/* Tags */}
            <div>
              <Label className="mb-3 block">Tags</Label>
              <div className="flex flex-wrap gap-2 mb-3">
                {tags.map((tag) => {
                  const sel = form.tagIds.includes(tag.id);
                  return (
                    <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all border-2 ${sel ? 'text-white border-transparent' : 'text-slate-600 bg-white border-slate-200 hover:border-slate-300'}`}
                      style={sel ? { backgroundColor: tag.color, borderColor: tag.color } : {}} aria-pressed={sel}>
                      {sel && <span>✓</span>}{tag.nombre}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mb-4">
                <Input placeholder="Nueva tag..." value={nuevaTagNombre}
                  onChange={(e) => setNuevaTagNombre(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), crearTag())}
                  className="max-w-[200px]" />
                <Button type="button" variant="outline" size="sm" onClick={crearTag} disabled={creandoTag || !nuevaTagNombre.trim()}>
                  {creandoTag ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* Precios adicionales por tag seleccionado */}
              {form.tagIds.length > 0 && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-xs font-semibold text-slate-700">
                    Precios adicionales por Tag (opcional — dejar vacío si no aplica recargo):
                  </div>
                  {form.tagIds.map((tagId) => {
                    const tag = tags.find((t) => t.id === tagId);
                    if (!tag) return null;
                    const precios = form.tagPrecios[tagId] || { bulto: '', pallet: '', kg: '', camion_completo: '' };
                    return (
                      <div key={tagId} className="rounded-md border border-slate-200 bg-white p-2.5 shadow-sm space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          <span className="text-xs font-medium text-slate-800">{tag.nombre}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">$/Bulto</label>
                            <Input
                              type="number"
                              min={0}
                              placeholder="Ej: 5000"
                              value={precios.bulto}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Number(e.target.value);
                                setForm((f) => ({
                                  ...f,
                                  tagPrecios: {
                                    ...f.tagPrecios,
                                    [tagId]: { ...(f.tagPrecios[tagId] ?? { bulto: '', pallet: '', kg: '', camion_completo: '' }), bulto: val },
                                  },
                                }));
                              }}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">$/Pallet</label>
                            <Input
                              type="number"
                              min={0}
                              placeholder="Ej: 15000"
                              value={precios.pallet}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Number(e.target.value);
                                setForm((f) => ({
                                  ...f,
                                  tagPrecios: {
                                    ...f.tagPrecios,
                                    [tagId]: { ...(f.tagPrecios[tagId] ?? { bulto: '', pallet: '', kg: '', camion_completo: '' }), pallet: val },
                                  },
                                }));
                              }}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">$/Kg (fijo)</label>
                            <Input
                              type="number"
                              min={0}
                              placeholder="Ej: 8000"
                              value={precios.kg}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Number(e.target.value);
                                setForm((f) => ({
                                  ...f,
                                  tagPrecios: {
                                    ...f.tagPrecios,
                                    [tagId]: { ...(f.tagPrecios[tagId] ?? { bulto: '', pallet: '', kg: '', camion_completo: '' }), kg: val },
                                  },
                                }));
                              }}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">Camión compl. ($)</label>
                            <Input
                              type="number"
                              min={0}
                              placeholder="Ej: 50000"
                              value={precios.camion_completo}
                              onChange={(e) => {
                                const val = e.target.value === '' ? '' : Number(e.target.value);
                                setForm((f) => ({
                                  ...f,
                                  tagPrecios: {
                                    ...f.tagPrecios,
                                    [tagId]: { ...(f.tagPrecios[tagId] ?? { bulto: '', pallet: '', kg: '', camion_completo: '' }), camion_completo: val },
                                  },
                                }));
                              }}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <Switch id="conf-activo" checked={form.activo} onCheckedChange={(v) => setForm((f) => ({ ...f, activo: v }))} />
              <Label htmlFor="conf-activo">Configuración activa</Label>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                id="apto-peritoneal"
                onClick={() => setForm((f) => ({ ...f, aptoPeritoneal: !f.aptoPeritoneal }))}
                className={`h-6 w-6 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${form.aptoPeritoneal ? 'bg-primary border-primary' : 'border-slate-300 hover:border-slate-400'}`}
                aria-pressed={form.aptoPeritoneal}
              >
                {form.aptoPeritoneal && <span className="text-white text-xs font-bold">✓</span>}
              </button>
              <div>
                <Label htmlFor="apto-peritoneal" className="cursor-pointer" onClick={() => setForm((f) => ({ ...f, aptoPeritoneal: !f.aptoPeritoneal }))}>
                  Apto peritoneal
                </Label>
                <p className="text-xs text-muted-foreground">Habilitado para transportar productos de diálisis peritoneal</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editandoId ? 'Guardar cambios' : 'Crear configuración'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!eliminandoId} onOpenChange={(o) => !o && setEliminandoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar configuración?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán las tarifas y tags asociadas. No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => eliminar(eliminandoId!)}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportarConfiguracionDialog open={importarOpen} onOpenChange={setImportarOpen} transportes={transportesParaImportar} onImported={finalizarImportacion} />
    </>
  );
}

// ─── Sub-componente TramoSection ───────────────────────────────────────────────

interface TramoSectionProps {
  label: string;
  icon: React.ReactNode;
  tramos: TramoForm[];
  unidad: string;
  paso: number;
  onAdd: () => void;
  onUpdate: (idx: number, campo: 'desde' | 'precio', valor: string) => void;
  onDelete: (idx: number) => void;
  hint: string;
}

function TramoSection({ label, icon, tramos, unidad, paso, onAdd, onUpdate, onDelete, hint }: TramoSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Label className="flex items-center gap-1.5">{icon}{label}</Label>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" />Agregar tramo
        </Button>
      </div>
      <div className="space-y-2">
        {tramos.map((tramo, idx) => (
          <div key={idx} className="flex items-end gap-2">
            <div className="w-36 space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">Desde {unidad} Nº</Label>}
              <Input type="number" min={paso} step={paso} placeholder={String(paso)}
                value={tramo.desde} onChange={(e) => onUpdate(idx, 'desde', e.target.value)} />
            </div>
            <div className="flex-1 space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">Precio por {unidad} ($)</Label>}
              <Input type="number" min={0} placeholder="90000"
                value={tramo.precio} onChange={(e) => onUpdate(idx, 'precio', e.target.value)} />
            </div>
            {tramos.length > 1 && (
              <button type="button" onClick={() => onDelete(idx)}
                className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors mb-0.5" aria-label="Eliminar tramo">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">{hint}</p>
    </div>
  );
}
