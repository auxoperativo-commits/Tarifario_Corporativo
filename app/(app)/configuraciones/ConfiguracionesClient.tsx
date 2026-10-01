'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';
import { puedeEditar } from '@/components/layout/AppShell';
import { useToast } from '@/hooks/use-toast';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import { EmptyState } from '@/components/layout/EmptyState';
import { formatearPrecio, normalizarUbicacion } from '@/lib/calculos/envios';
import { parsearNumeroLocal } from '@/lib/numeros';
import { ImportarConfiguracionDialog } from './ImportarConfiguracionDialog';
import type {
  Transporte, Tag, Caracteristica, ServicioTransporte, ConfiguracionEnvio,
  TarifaBulto, TarifaPallet, TarifaKg, TagPrecio, UbicacionSeleccionada, UbicacionPersonalizada, Sucursal, GrupoSucursales, GrupoSucursalesMiembros,
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
  Plus, Pencil, Trash2, Settings, Clock, Package, Truck, Loader2, X, ChevronDown, ChevronUp, Upload, Search, Weight, Copy, Shapes,
} from 'lucide-react';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface TramoForm {
  id?: string;
  desde: number | '';
  precio: number | string;
  esValorInicial?: boolean; // solo aplica al tramo con desde = 1
}

interface ConfiguracionConRelaciones extends ConfiguracionEnvio {
  tarifas_bulto: TarifaBulto[];
  tarifas_pallet?: TarifaPallet[];
  tarifas_kg?: TarifaKg[];
  configuracion_tags: { tag_id: string; configuracion_tag_precios?: TagPrecio[] }[];
  configuracion_tag_precios?: TagPrecio[];
  configuracion_caracteristicas?: { caracteristica_id: string }[];
  configuracion_servicios?: Array<{ servicio_id: string; valor: number | string | null; servicios_transporte?: ServicioTransporte | null }>;
}

interface FormData {
  origen: UbicacionSeleccionada | null;
  origenSucursalId: string | null;
  origenGrupoId: string | null;
  origenTipo: 'sucursal' | 'grupo' | 'georef';
  destino: UbicacionSeleccionada | null;
  tiempo_min: number | '';
  tiempo_max: number | '';
  precio_camion: number | string;
  activo: boolean;
  aptoPeritoneal: boolean;
  modoPrecioPallet: 'precio_por_unidad' | 'precio_total_tramo';
  modoUmbralKg: 'desde' | 'hasta';
  tramosBulto: TramoForm[];
  tramosPallet: TramoForm[];
  tramosKg: TramoForm[];
  tagIds: string[];
  // Precios adicionales por tag: clave = tag_id, valor = precios opcionales por unidad
  tagPrecios: Record<string, {
    bulto: number | string;
    pallet: number | string;
    kg: number | string;
    camion_completo: number | string;
  }>;
  caracteristicaIds: string[];
  servicioIds: string[];
  servicioValores: Record<string, number | string>;
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

function isKgSchemaMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /column\s+\"?(umbral_kg|desde_kg)\"?\s+does not exist|column\s+\"?(umbral_kg|desde_kg)\"?\s+no existe/i.test(message);
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

  if (!provincia && !nombre) return 'Sin ubicación';

  // Sucursales: mostrar solo "Nombre · Localidad" sin duplicar provincia
  if (ubicacion?.tipo === 'sucursal' && nombre) {
    return localidad ? `${nombre} · ${localidad}` : nombre;
  }

  // Grupos: mostrar el nombre del grupo
  if (ubicacion?.tipo === 'grupo' && nombre) {
    return nombre;
  }

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
  origenSucursalId: null,
  origenGrupoId: null,
  origenTipo: 'sucursal',
  destino: null,
  tiempo_min: '',
  tiempo_max: '',
  precio_camion: '',
  activo: true,
  aptoPeritoneal: false,
  modoPrecioPallet: 'precio_por_unidad',
  modoUmbralKg: 'desde',
  tramosBulto: [{ desde: 1, precio: '', esValorInicial: false }],
  tramosPallet: [{ desde: 1, precio: '' }],
  tramosKg: [{ desde: 1, precio: '' }],
  tagIds: [],
  tagPrecios: {},
  caracteristicaIds: [],
  servicioIds: [],
  servicioValores: {},
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  transportes: Transporte[];
  transportesParaImportar: Transporte[];
  tagsIniciales: Tag[];
  caracteristicasIniciales: Caracteristica[];
  serviciosIniciales: ServicioTransporte[];
  sucursales: Sucursal[];
  grupos: GrupoSucursales[];
  gruposMiembros?: GrupoSucursalesMiembros[];
  transportePreseleccionadoId: string | null;
  configuracionesIniciales: unknown[];
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ConfiguracionesClient({
  transportes, transportesParaImportar, tagsIniciales, caracteristicasIniciales, serviciosIniciales, sucursales, grupos, gruposMiembros = [], transportePreseleccionadoId, configuracionesIniciales,
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
  const [caracteristicas, setCaracteristicas] = useState<Caracteristica[]>(caracteristicasIniciales);
  const [servicios, setServicios] = useState<ServicioTransporte[]>(serviciosIniciales);
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
  const [vistaActiva, setVistaActiva] = useState<'configuraciones' | 'ubicaciones'>('configuraciones');
  const [ubicacionSeleccionadaId, setUbicacionSeleccionadaId] = useState<string | null>(null);
  const [nuevoMiembroUbicacion, setNuevoMiembroUbicacion] = useState({ provincia: '', localidad: '' });
  const [guardandoMiembroUbicacion, setGuardandoMiembroUbicacion] = useState(false);

  useEffect(() => {
    async function cargarUbicaciones() {
      try {
        const { data } = await supabase
          .from('ubicaciones_personalizadas')
          .select('*, ubicacion_personalizada_miembros(*)')
          .order('nombre');
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
      .select(`*, tarifas_bulto(*), tarifas_pallet(*), tarifas_kg(*), configuracion_tags(tag_id), configuracion_tag_precios(*), configuracion_caracteristicas(caracteristica_id), configuracion_servicios(servicio_id, valor, servicios_transporte(*))`)
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
    let formInicial = FORM_VACIO;

    // FIX 2: Sucursal predeterminada por usuario -> Autocompletar Grupo al crear Configuraciones
    // 1. Buscar si el usuario logueado tiene una sucursal predeterminada guardada en su perfil
    const sucursalPredId = perfil?.origen_predeterminado_sucursal_id;

    if (sucursalPredId) {
      // 2. Buscar a qué Grupo(s) de Sucursales pertenece esa sucursal (vía grupo_sucursales_miembros)
      const grupoIds = gruposMiembros
        .filter((m) => m.sucursal_id === sucursalPredId)
        .map((m) => m.grupo_id);

      // Si pertenece a uno o más grupos activos, priorizar el primero en orden alfabético por nombre
      // Criterio de ordenamiento: Alfabético por `nombre` de grupo de forma consistente
      const gruposCoincidentes = grupos
        .filter((g) => g.activo && grupoIds.includes(g.id))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

      if (gruposCoincidentes.length > 0) {
        const primerGrupo = gruposCoincidentes[0];
        formInicial = {
          ...FORM_VACIO,
          origenTipo: 'grupo',
          origenGrupoId: primerGrupo.id,
          origen: {
            provincia: '',
            localidad: null,
            nombre: primerGrupo.nombre,
            tipo: 'grupo',
            id: primerGrupo.id,
          },
        };
      }
    }

    setForm(formInicial);
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
        ? [...arr].sort((a, b) => (a.umbral_kg ?? a.desde_kg ?? 0) - (b.umbral_kg ?? b.desde_kg ?? 0)).map((t) => ({
            id: t.id, desde: t.umbral_kg ?? t.desde_kg ?? '', precio: t.precio,
          }))
        : [{ desde: 1, precio: '' }];

    setForm({
      origen: {
        provincia: c.origen_provincia,
        localidad: c.origen_localidad ?? null,
        id: c.origen_ubicacion_personalizada_id ?? c.origen_sucursal_id ?? c.origen_grupo_id ?? undefined,
        nombre: c.origen_nombre_personalizado ?? grupos.find((grupo) => grupo.id === c.origen_grupo_id)?.nombre ?? undefined,
        tipo: c.origen_ubicacion_personalizada_id ? 'personalizada' : c.origen_sucursal_id ? 'sucursal' : c.origen_grupo_id ? 'grupo' : 'georef',
      },
      origenSucursalId: c.origen_sucursal_id ?? null,
      origenGrupoId: c.origen_grupo_id ?? null,
      origenTipo: c.origen_grupo_id ? 'grupo' : c.origen_sucursal_id ? 'sucursal' : 'georef',
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
      modoPrecioPallet: c.modo_precio_pallet ?? 'precio_por_unidad',
      modoUmbralKg: c.modo_umbral_kg ?? 'desde',
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
      caracteristicaIds: (c.configuracion_caracteristicas ?? []).map((cc) => cc.caracteristica_id),
      servicioIds: (c.configuracion_servicios ?? []).map((cs) => cs.servicio_id),
      servicioValores: Object.fromEntries(
        (c.configuracion_servicios ?? []).map((cs) => [cs.servicio_id, cs.valor ?? ''])
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
      arr[idx] = { ...arr[idx], [k]: k === 'precio' ? v : (v === '' ? '' : Number(v)) };
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

  // ── Características ───────────────────────────────────────────────────────
  function toggleCaracteristica(id: string) {
    setForm((f) => {
      const seleccionada = f.caracteristicaIds.includes(id);
      return {
        ...f,
        caracteristicaIds: seleccionada
          ? f.caracteristicaIds.filter((x) => x !== id)
          : [...f.caracteristicaIds, id],
      };
    });
  }

  function toggleServicio(id: string) {
    setForm((f) => {
      const seleccionada = f.servicioIds.includes(id);
      const nuevosServicioIds = seleccionada ? f.servicioIds.filter((x) => x !== id) : [...f.servicioIds, id];
      const nuevosValores = { ...f.servicioValores };
      if (!seleccionada && !(id in nuevosValores)) {
        nuevosValores[id] = '';
      }
      if (seleccionada) {
        delete nuevosValores[id];
      }
      return { ...f, servicioIds: nuevosServicioIds, servicioValores: nuevosValores };
    });
  }

  // ── Validar ───────────────────────────────────────────────────────────────
  function validar(): string | null {
    const origenSeleccionado = Boolean(form.origenSucursalId || form.origenGrupoId || form.origen?.provincia);
    if (!origenSeleccionado) return 'Seleccioná el origen.';
    if (!form.destino?.provincia) return 'Seleccioná el destino.';
    if (form.tiempo_min === '' || form.tiempo_max === '') return 'El tiempo estimado mínimo y máximo son obligatorios.';
    if (Number(form.tiempo_min) < 0 || Number(form.tiempo_max) < 0) return 'El tiempo estimado no puede ser negativo.';
    if (Number(form.tiempo_min) > Number(form.tiempo_max)) return 'El tiempo mínimo no puede ser mayor al máximo.';

    for (const [campo, label] of [['tramosBulto', 'bulto'], ['tramosPallet', 'pallet'], ['tramosKg', 'kg']] as const) {
      const filled = form[campo].filter((t) => t.desde !== '' && t.precio !== '');
      const desdes = filled.map((t) => t.desde);
      if (new Set(desdes).size !== desdes.length) return `Hay valores "desde ${label}" repetidos.`;
      if (filled.some((t) => Number(t.desde) <= 0)) return `"Desde ${label}" debe ser mayor a 0.`;
      if (filled.some((t) => {
        const precio = parsearNumeroLocal(t.precio);
        return precio === null || precio < 0;
      })) return `Ingresá un precio válido para ${label}.`;
    }
    if (form.precio_camion !== '' && (parsearNumeroLocal(form.precio_camion) ?? -1) < 0) return 'Ingresá un precio válido para camión completo.';
    for (const precios of Object.values(form.tagPrecios)) {
      if (Object.values(precios).some((precio) => precio !== '' && ((parsearNumeroLocal(precio) ?? -1) < 0))) {
        return 'Ingresá precios válidos para los tags.';
      }
    }
    for (const servicio of Object.values(form.servicioValores)) {
      if (servicio !== '' && ((parsearNumeroLocal(servicio) ?? -1) < 0)) {
        return 'Ingresá valores válidos para los servicios de transporte.';
      }
    }
    return null;
  }

  async function guardarTarifasKg(configId: string, fechaActualizacion: string) {
    const kgFilled = form.tramosKg.filter((t) => t.desde !== '' && t.precio !== '');
    const kgConId = kgFilled.filter((t) => t.id).map((t) => t.id!);
    const kgEliminados = editandoId
      ? (configs.find((c) => c.id === configId)?.tarifas_kg ?? []).filter((t) => !kgConId.includes(t.id)).map((t) => t.id)
      : [];

    if (kgEliminados.length) {
      const { error: errorDelete } = await supabase.from('tarifas_kg').delete().in('id', kgEliminados);
      if (errorDelete) throw errorDelete;
    }

    for (const tramo of kgFilled) {
      const datosModernos = {
        umbral_kg: Number(tramo.desde),
        precio: parsearNumeroLocal(tramo.precio)!,
        updated_at: fechaActualizacion,
      };
      const datosLegado = {
        desde_kg: Number(tramo.desde),
        precio: parsearNumeroLocal(tramo.precio)!,
        updated_at: fechaActualizacion,
      };

      if (tramo.id) {
        const { error } = await supabase.from('tarifas_kg').update(datosModernos).eq('id', tramo.id);
        if (error) {
          if (!isKgSchemaMismatchError(error)) throw error;
          const { error: errorLegacy } = await supabase.from('tarifas_kg').update(datosLegado).eq('id', tramo.id);
          if (errorLegacy) throw errorLegacy;
        }
        continue;
      }

      const { error } = await supabase.from('tarifas_kg').insert({ configuracion_id: configId, ...datosModernos });
      if (error) {
        if (!isKgSchemaMismatchError(error)) throw error;
        const { error: errorLegacy } = await supabase.from('tarifas_kg').insert({ configuracion_id: configId, ...datosLegado });
        if (errorLegacy) throw errorLegacy;
      }
    }
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  async function guardar() {
    const err = validar();
    if (err) { toast({ variant: 'destructive', title: err }); return; }
    setSaving(true);
    try {
      const fechaActualizacion = new Date().toISOString();
      const sucursalSeleccionada = sucursales.find((sucursal) => sucursal.id === form.origenSucursalId) ?? null;
      const grupoSeleccionado = grupos.find((grupo) => grupo.id === form.origenGrupoId) ?? null;
      const grupoMiembrosIds = form.origenGrupoId
        ? gruposMiembros.filter((m) => m.grupo_id === form.origenGrupoId).map((m) => m.sucursal_id)
        : [];
      const primeraSucursalDelGrupo = sucursales.find((s) => grupoMiembrosIds.includes(s.id));

      const origenProvincia = form.origenTipo === 'sucursal'
        ? (sucursalSeleccionada?.provincia ?? form.origen?.provincia ?? '')
        : form.origenTipo === 'grupo'
          ? (form.origen?.provincia || primeraSucursalDelGrupo?.provincia || '')
          : (form.origen?.provincia ?? '');

      const origenLocalidad = form.origenTipo === 'sucursal'
        ? (sucursalSeleccionada?.localidad ?? form.origen?.localidad ?? null)
        : (form.origen?.localidad ?? null);

      const origenSucursalSeleccionada = form.origenTipo === 'sucursal' ? form.origenSucursalId ?? null : null;
      const origenGrupoSeleccionado = form.origenTipo === 'grupo' ? form.origenGrupoId ?? null : null;
      const payload = {
        transporte_id: transporteId,
        origen_sucursal_id: origenSucursalSeleccionada,
        origen_grupo_id: origenGrupoSeleccionado,
        origen_provincia: origenProvincia,
        origen_localidad: origenLocalidad,
        origen_nombre_personalizado: form.origen?.tipo === 'personalizada' ? form.origen.nombre ?? form.origen.provincia : null,
        origen_ubicacion_personalizada_id: form.origen?.tipo === 'personalizada' ? form.origen.id ?? null : null,
        destino_provincia: form.destino!.provincia,
        destino_localidad: form.destino!.localidad ?? null,
        destino_nombre_personalizado: form.destino?.tipo === 'personalizada' ? form.destino.nombre ?? form.destino.provincia : null,
        destino_ubicacion_personalizada_id: form.destino?.tipo === 'personalizada' ? form.destino.id ?? null : null,
        tiempo_estimado_min_horas: form.tiempo_min !== '' ? Number(form.tiempo_min) : null,
        tiempo_estimado_max_horas: form.tiempo_max !== '' ? Number(form.tiempo_max) : null,
        precio_pallet: null,
        precio_camion_completo: form.precio_camion !== '' ? parsearNumeroLocal(form.precio_camion) : null,
        precio_camion_actualizado_at: form.precio_camion !== '' ? fechaActualizacion : null,
        modo_precio_pallet: form.modoPrecioPallet,
        modo_umbral_kg: form.modoUmbralKg,
        apto_peritoneal: form.aptoPeritoneal,
        activo: form.activo,
        es_copia: false,
        nombre_copia: null,
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

      const bultosFilled = form.tramosBulto.filter((t) => t.desde !== '' && t.precio !== '');
      const bultosConId = bultosFilled.filter((t) => t.id).map((t) => t.id!);
      const bultosEliminados = editandoId
        ? (configs.find((c) => c.id === configId)?.tarifas_bulto ?? []).filter((t) => !bultosConId.includes(t.id)).map((t) => t.id)
        : [];
      if (bultosEliminados.length) await supabase.from('tarifas_bulto').delete().in('id', bultosEliminados);
      for (const tramo of bultosFilled) {
        const datos = { desde_bulto: Number(tramo.desde), precio: parsearNumeroLocal(tramo.precio)!, es_valor_inicial: tramo.esValorInicial ?? false, updated_at: fechaActualizacion };
        const { error } = tramo.id
          ? await supabase.from('tarifas_bulto').update(datos).eq('id', tramo.id)
          : await supabase.from('tarifas_bulto').insert({ configuracion_id: configId, ...datos });
        if (error) throw error;
      }

      // tarifas_pallet (solo si la tabla existe — migración 01_tarifas_pallet.sql)
      try {
        const palletsFilled = form.tramosPallet.filter((t) => t.desde !== '' && t.precio !== '');
        const palletsConId = palletsFilled.filter((t) => t.id).map((t) => t.id!);
        const palletsEliminados = editandoId
          ? (configs.find((c) => c.id === configId)?.tarifas_pallet ?? []).filter((t) => !palletsConId.includes(t.id)).map((t) => t.id)
          : [];
        if (palletsEliminados.length) await supabase.from('tarifas_pallet').delete().in('id', palletsEliminados);
        for (const tramo of palletsFilled) {
          const datos = { desde_pallet: Number(tramo.desde), precio: parsearNumeroLocal(tramo.precio)!, updated_at: fechaActualizacion };
          const { error } = tramo.id
            ? await supabase.from('tarifas_pallet').update(datos).eq('id', tramo.id)
            : await supabase.from('tarifas_pallet').insert({ configuracion_id: configId, ...datos });
          if (error) throw error;
        }
      } catch {
        console.warn('tarifas_pallet no encontrada. Ejecutar supabase/migrations/01_tarifas_pallet.sql');
      }

      // tarifas_kg: compatibilidad con schemas viejos/nuevos (umbral_kg vs desde_kg)
      await guardarTarifasKg(configId, fechaActualizacion);

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
            const pBulto = precios.bulto !== '' ? parsearNumeroLocal(precios.bulto) : null;
            const pPallet = precios.pallet !== '' ? parsearNumeroLocal(precios.pallet) : null;
            const pKg = precios.kg !== '' ? parsearNumeroLocal(precios.kg) : null;
            const pCamion = precios.camion_completo !== '' ? parsearNumeroLocal(precios.camion_completo) : null;
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

      // características de transporte (delete-then-insert, sin precios)
      try {
        await supabase.from('configuracion_caracteristicas').delete().eq('configuracion_id', configId);
        if (form.caracteristicaIds.length > 0) {
          await supabase.from('configuracion_caracteristicas').insert(
            form.caracteristicaIds.map((caracteristica_id) => ({ configuracion_id: configId, caracteristica_id }))
          );
        }
      } catch {
        console.warn('configuracion_caracteristicas no encontrada. Ejecutar supabase/migrations/12_caracteristicas_transporte.sql');
      }

      // servicios de transporte con valor fijo por configuración
      try {
        await supabase.from('configuracion_servicios').delete().eq('configuracion_id', configId);
        const serviciosParaGuardar = form.servicioIds
          .map((servicio_id) => {
            const valor = form.servicioValores[servicio_id];
            if (valor === undefined || valor === '') return null;
            const valorNumerico = parsearNumeroLocal(valor);
            if (valorNumerico === null) return null;
            return { configuracion_id: configId, servicio_id, valor: valorNumerico };
          })
          .filter((item): item is { configuracion_id: string; servicio_id: string; valor: number } => item !== null);
        if (serviciosParaGuardar.length > 0) {
          await supabase.from('configuracion_servicios').insert(serviciosParaGuardar);
        }
      } catch {
        console.warn('configuracion_servicios no encontrada. Ejecutar supabase/migrations/17_servicios_transporte.sql');
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
      .update({ activo: !c.activo, es_copia: false, nombre_copia: null, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast({ variant: 'destructive', title: 'Error.' }); return; }
    setConfigs((p) => p.map((x) => x.id === c.id ? { ...x, activo: !x.activo } : x));
  }

  const getTag = (id: string) => tags.find((t) => t.id === id);
  const transporteActual = transportes.find((t) => t.id === transporteId);
  const configsFiltradas = useMemo(() => {
    const texto = normalizarUbicacion(filtroConfiguraciones);
    if (!texto) return configs;
    return configs.filter((config) => {
      const grupo = config.origen_grupo_id ? grupos.find((g) => g.id === config.origen_grupo_id) : null;
      const sucursal = config.origen_sucursal_id ? sucursales.find((s) => s.id === config.origen_sucursal_id) : null;
      return [
        config.origen_provincia,
        config.origen_localidad,
        config.destino_provincia,
        config.destino_localidad,
        grupo?.nombre,
        sucursal?.nombre,
        config.origen_nombre_personalizado,
        config.destino_nombre_personalizado,
      ].some((valor) => normalizarUbicacion(valor).includes(texto));
    });
  }, [configs, filtroConfiguraciones, grupos, sucursales]);

  async function finalizarImportacion(tid: string) {
    setTransporteId(tid);
    await cargar(tid);
  }

  async function duplicarConfiguracion(c: ConfiguracionConRelaciones) {
    const { error } = await supabase.rpc('duplicar_configuracion', { configuracion_origen: c.id });
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo duplicar la configuraciÃ³n.', description: error.message });
      return;
    }
    await cargar(transporteId);
    toast({ title: 'ConfiguraciÃ³n duplicada.', description: 'La copia queda identificada hasta que la edites y guardes.' });
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

        const { error: errorMiembro } = await supabase.from('ubicacion_personalizada_miembros').upsert([
          {
            ubicacion_personalizada_id: data.id,
            provincia: nuevaUbicacion.provincia.trim(),
            localidad: nuevaUbicacion.localidad.trim() || null,
          }
        ], { onConflict: 'ubicacion_personalizada_id,provincia,localidad' });
        if (errorMiembro && !/does not exist|relation .*ubicacion_personalizada_miembros.* does not exist/i.test(errorMiembro.message)) {
          throw errorMiembro;
        }

        setUbicacionesPersonalizadas((prev) => prev.map((item) => item.id === data.id ? { ...data, ubicacion_personalizada_miembros: [{ id: crypto.randomUUID(), ubicacion_personalizada_id: data.id, provincia: nuevaUbicacion.provincia.trim(), localidad: nuevaUbicacion.localidad.trim() || null, created_at: new Date().toISOString() }] } as UbicacionPersonalizada : item));
        toast({ title: 'Ubicación personalizada actualizada.' });
      } else {
        const { data, error } = await supabase.from('ubicaciones_personalizadas').insert({
          usuario_id: perfil.id,
          nombre: nuevaUbicacion.nombre.trim(),
          provincia: nuevaUbicacion.provincia.trim(),
          localidad: nuevaUbicacion.localidad.trim() || null,
        }).select().single();
        if (error) throw error;

        const { error: errorMiembro } = await supabase.from('ubicacion_personalizada_miembros').insert({
          ubicacion_personalizada_id: data.id,
          provincia: nuevaUbicacion.provincia.trim(),
          localidad: nuevaUbicacion.localidad.trim() || null,
        });
        if (errorMiembro && !/does not exist|relation .*ubicacion_personalizada_miembros.* does not exist/i.test(errorMiembro.message)) {
          throw errorMiembro;
        }

        setUbicacionesPersonalizadas((prev) => [...prev, { ...data, ubicacion_personalizada_miembros: [{ id: crypto.randomUUID(), ubicacion_personalizada_id: data.id, provincia: nuevaUbicacion.provincia.trim(), localidad: nuevaUbicacion.localidad.trim() || null, created_at: new Date().toISOString() }] } as UbicacionPersonalizada]);
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
    setVistaActiva('ubicaciones');
    setUbicacionSeleccionadaId(item.id);
  }

  const ubicacionSeleccionada = ubicacionesPersonalizadas.find((item) => item.id === ubicacionSeleccionadaId) ?? null;

  const miembrosUbicacionSeleccionada = ubicacionSeleccionada
    ? (Array.isArray(ubicacionSeleccionada.ubicacion_personalizada_miembros) && ubicacionSeleccionada.ubicacion_personalizada_miembros.length > 0
      ? ubicacionSeleccionada.ubicacion_personalizada_miembros
      : [{
          id: ubicacionSeleccionada.id,
          ubicacion_personalizada_id: ubicacionSeleccionada.id,
          provincia: ubicacionSeleccionada.provincia,
          localidad: ubicacionSeleccionada.localidad ?? null,
          created_at: ubicacionSeleccionada.created_at,
        }])
    : [];

  async function guardarMiembroUbicacion() {
    if (!ubicacionSeleccionadaId || !nuevoMiembroUbicacion.provincia.trim()) return;
    setGuardandoMiembroUbicacion(true);
    try {
      const payload = {
        ubicacion_personalizada_id: ubicacionSeleccionadaId,
        provincia: nuevoMiembroUbicacion.provincia.trim(),
        localidad: nuevoMiembroUbicacion.localidad.trim() || null,
      };

      const { error } = await supabase.from('ubicacion_personalizada_miembros').upsert(payload, {
        onConflict: 'ubicacion_personalizada_id,provincia,localidad',
      });
      if (error && !/does not exist|relation .*ubicacion_personalizada_miembros.* does not exist/i.test(error.message)) {
        throw error;
      }

      const { data } = await supabase
        .from('ubicaciones_personalizadas')
        .select('*, ubicacion_personalizada_miembros(*)')
        .eq('id', ubicacionSeleccionadaId)
        .single();

      if (data) {
        setUbicacionesPersonalizadas((prev) => prev.map((item) => item.id === data.id ? (data as UbicacionPersonalizada) : item));
        setUbicacionSeleccionadaId(data.id);
      }
      setNuevoMiembroUbicacion({ provincia: '', localidad: '' });
      toast({ title: 'Miembro agregado.' });
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo agregar la localidad.' });
    } finally {
      setGuardandoMiembroUbicacion(false);
    }
  }

  async function eliminarMiembroUbicacion(miembroId: string) {
    if (!miembroId) return;
    const { error } = await supabase.from('ubicacion_personalizada_miembros').delete().eq('id', miembroId);
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo quitar la localidad.' });
      return;
    }

    setUbicacionesPersonalizadas((prev) => prev.map((item) => item.id === ubicacionSeleccionadaId
      ? { ...item, ubicacion_personalizada_miembros: (item.ubicacion_personalizada_miembros ?? []).filter((m) => m.id !== miembroId) }
      : item));
    toast({ title: 'Localidad quitada.' });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Selector transporte */}
      <div className="bg-white border rounded-xl p-4 mb-6">
        <Label className="text-sm font-medium mb-2 block">Transporte</Label>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
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

          <div className="flex flex-wrap items-center gap-2">
            {transporteId && editar && <Button onClick={abrirNuevo} className="shrink-0"><Plus className="mr-2 h-4 w-4" />Agregar configuración</Button>}
            <Button type="button" variant={vistaActiva === 'configuraciones' ? 'default' : 'outline'} onClick={() => setVistaActiva('configuraciones')}>Configuraciones</Button>
            <Button type="button" variant={vistaActiva === 'ubicaciones' ? 'default' : 'outline'} onClick={() => setVistaActiva('ubicaciones')}>Ubicaciones personalizadas</Button>
            {editar && <Button variant="outline" onClick={() => setImportarOpen(true)} className="shrink-0"><Upload className="mr-2 h-4 w-4" />Importar configuración</Button>}
          </div>
        </div>
      </div>

      {vistaActiva === 'ubicaciones' ? (
        <div className="bg-white border rounded-xl p-4 mb-6">
          <div className="mb-4 grid gap-3 md:grid-cols-[1.2fr_1.5fr_1fr_auto]">
            <Input value={nuevaUbicacion.nombre} onChange={(event) => setNuevaUbicacion((prev) => ({ ...prev, nombre: event.target.value }))} placeholder="Nombre de la ubicación" />
            <div className="min-w-0">
              <GeorefCombobox
                label="Provincia"
                value={nuevaUbicacion.provincia ? { provincia: nuevaUbicacion.provincia, localidad: nuevaUbicacion.localidad || null } : null}
                onChange={(ubicacion) => setNuevaUbicacion((prev) => ({ ...prev, provincia: ubicacion?.provincia ?? '', localidad: ubicacion?.localidad ?? prev.localidad }))}
                placeholder="Seleccionar provincia..."
                localidadOpcional
                className="space-y-1"
              />
            </div>
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

          {ubicacionesPersonalizadas.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
              <div className="space-y-2 rounded-lg border bg-slate-50 p-2">
                {ubicacionesPersonalizadas.map((ubicacion) => (
                  <button
                    type="button"
                    key={ubicacion.id}
                    onClick={() => setUbicacionSeleccionadaId(ubicacion.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${ubicacionSeleccionadaId === ubicacion.id ? 'border-primary bg-white shadow-sm' : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white'}`}
                  >
                    <span className="font-medium text-slate-700">{ubicacion.nombre}</span>
                    <span className="text-xs text-muted-foreground">{(ubicacion.ubicacion_personalizada_miembros ?? []).length || 1} miembro(s)</span>
                  </button>
                ))}
              </div>

              <div className="rounded-lg border bg-white p-3">
                {ubicacionSeleccionada ? (
                  <>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-800">{ubicacionSeleccionada.nombre}</p>
                        <p className="text-xs text-muted-foreground">{ubicacionSeleccionada.provincia}{ubicacionSeleccionada.localidad ? ` · ${ubicacionSeleccionada.localidad}` : ''}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => editarUbicacionPersonalizada(ubicacionSeleccionada)}><Pencil className="mr-1 h-3 w-3" />Editar</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => eliminarUbicacionPersonalizada(ubicacionSeleccionada.id)} className="text-red-600 hover:text-red-700"><Trash2 className="mr-1 h-3 w-3" />Eliminar</Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_auto]">
                      <div className="min-w-0">
                        <GeorefCombobox
                          label="Nueva provincia"
                          value={nuevoMiembroUbicacion.provincia ? { provincia: nuevoMiembroUbicacion.provincia, localidad: nuevoMiembroUbicacion.localidad || null } : null}
                          onChange={(ubicacion) => setNuevoMiembroUbicacion((prev) => ({ ...prev, provincia: ubicacion?.provincia ?? '', localidad: ubicacion?.localidad ?? prev.localidad }))}
                          placeholder="Seleccionar provincia..."
                          localidadOpcional
                          className="space-y-1"
                        />
                      </div>
                      <Input value={nuevoMiembroUbicacion.localidad} onChange={(event) => setNuevoMiembroUbicacion((prev) => ({ ...prev, localidad: event.target.value }))} placeholder="Localidad" />
                      <Button type="button" onClick={guardarMiembroUbicacion} disabled={guardandoMiembroUbicacion} variant="outline">
                        {guardandoMiembroUbicacion ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Agregar'}
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      {miembrosUbicacionSeleccionada.map((miembro) => (
                        <div key={miembro.id} className="flex items-center justify-between gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm">
                          <span>{miembro.provincia}{miembro.localidad ? ` · ${miembro.localidad}` : ''}</span>
                          <button type="button" onClick={() => eliminarMiembroUbicacion(miembro.id)} className="text-red-500 hover:text-red-700" aria-label="Eliminar miembro">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Seleccioná una ubicación para ver y editar sus provincias/localidades asociadas.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-slate-50 p-5 text-sm text-muted-foreground">
              Todavía no hay ubicaciones personalizadas. Creá la primera arriba para empezar a sumar localidades.
            </div>
          )}
        </div>
      ) : null}

      {vistaActiva === 'configuraciones' && (
      <>

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
                        {(() => {
                          const grupoOrigen = c.origen_grupo_id
                            ? grupos.find((g) => g.id === c.origen_grupo_id)
                            : null;
                          const sucursalOrigen = c.origen_sucursal_id
                            ? sucursales.find((s) => s.id === c.origen_sucursal_id)
                            : null;

                          if (c.origen_grupo_id) {
                            return (
                              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 text-sm">
                                <Shapes className="h-4 w-4 text-indigo-600 shrink-0" />
                                <span>{grupoOrigen?.nombre ?? c.origen_nombre_personalizado ?? 'Grupo'}</span>
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal border-indigo-200 text-indigo-700 bg-indigo-50 shrink-0">
                                  Grupo
                                </Badge>
                              </span>
                            );
                          }

                          return formatearRutaConNombre(
                            {
                              provincia: c.origen_provincia,
                              localidad: c.origen_localidad ?? null,
                              nombre: sucursalOrigen?.nombre ?? c.origen_nombre_personalizado ?? undefined,
                              tipo: sucursalOrigen ? 'sucursal' : (c.origen_ubicacion_personalizada_id ? 'personalizada' : 'georef'),
                            },
                            c.origen_provincia,
                            c.origen_localidad ?? null,
                            sucursalOrigen?.nombre ?? c.origen_nombre_personalizado,
                          );
                        })()}
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
                      {c.es_copia && (
                        <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-800">
                          {c.nombre_copia ?? 'Copia pendiente'}
                        </Badge>
                      )}
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
                    {(() => {
                      const serviciosDeLaConfig = (c.configuracion_servicios ?? [])
                        .map((cs) => {
                          const servicio = servicios.find((s) => s.id === cs.servicio_id);
                          if (!servicio) return null;
                          return { id: servicio.id, nombre: servicio.nombre, valor: Number(cs.valor ?? 0) };
                        })
                        .filter(Boolean) as Array<{ id: string; nombre: string; valor: number }>;
                      if (!serviciosDeLaConfig.length) return null;
                      return (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {serviciosDeLaConfig.map((servicio) => (
                            <span key={servicio.id} className="rounded-[6px] border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {servicio.nombre} · {formatearPrecio(servicio.valor)}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    {(() => {
                      const caracsDeLaConfig = (c.configuracion_caracteristicas ?? [])
                        .map((cc) => caracteristicas.find((car) => car.id === cc.caracteristica_id))
                        .filter(Boolean) as Caracteristica[];
                      if (!caracsDeLaConfig.length) return null;
                      return (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {caracsDeLaConfig.map((car) => (
                            <span
                              key={car.id}
                              className="rounded-full border px-2 py-0.5 text-xs font-medium"
                              style={{ borderColor: car.color, color: car.color }}
                            >
                              {car.nombre}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setExpandidas((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                      className="text-xs text-muted-foreground hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100">
                      {exp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}Detalle
                    </button>
                    {editar && (
                      <>
                        <Switch checked={c.activo} onCheckedChange={() => toggleActivo(c)} aria-label="Activo/Inactivo" />
                        <Button variant="outline" size="sm" onClick={() => duplicarConfiguracion(c)} title="Duplicar configuraciÃ³n"><Copy className="h-3.5 w-3.5" /></Button>
                        <Button variant="outline" size="sm" onClick={() => abrirEdicion(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="outline" size="sm" onClick={() => setEliminandoId(c.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                  </div>
                </div>

                {exp && (
                  <div className="border-t px-4 py-3 bg-slate-50 space-y-3">
                    {c.origen_grupo_id && (
                      <div className="flex items-center gap-2 text-xs text-slate-700 pb-2 border-b">
                        <Shapes className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        <span className="font-semibold text-slate-800">Origen (Grupo de Sucursales):</span>
                        <span className="font-medium">{grupos.find((g) => g.id === c.origen_grupo_id)?.nombre ?? 'Grupo'}</span>
                      </div>
                    )}
                    {c.origen_sucursal_id && (
                      <div className="flex items-center gap-2 text-xs text-slate-700 pb-2 border-b">
                        <span className="font-semibold text-slate-800">Origen (Sucursal):</span>
                        <span className="font-medium">
                          {(() => {
                            const suc = sucursales.find((s) => s.id === c.origen_sucursal_id);
                            return suc ? `${suc.nombre} · ${suc.localidad}` : 'Sucursal';
                          })()}
                        </span>
                      </div>
                    )}
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
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tramos kg</p>
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal border-slate-200 text-slate-700 bg-slate-100">
                            {c.modo_umbral_kg === 'hasta' ? 'Modo Hasta' : 'Modo Desde'}
                          </Badge>
                        </div>
                        {[...(c.tarifas_kg ?? [])].sort((a, b) => (a.umbral_kg ?? a.desde_kg ?? 0) - (b.umbral_kg ?? b.desde_kg ?? 0)).map((t, i, arr) => {
                          const umbral = t.umbral_kg ?? t.desde_kg ?? 0;
                          let textoTramo = '';
                          if (c.modo_umbral_kg === 'hasta') {
                            const umbralAnterior = i > 0 ? (arr[i - 1].umbral_kg ?? arr[i - 1].desde_kg ?? 0) : 0;
                            textoTramo = i === 0 ? `Hasta ${umbral} kg` : `Más de ${umbralAnterior} kg hasta ${umbral} kg`;
                          } else {
                            textoTramo = i === arr.length - 1
                              ? `Desde ${umbral} kg en adelante`
                              : `${umbral}–${arr[i + 1].umbral_kg ?? arr[i + 1].desde_kg ?? 0} kg`;
                          }
                          return (
                            <div key={t.id} className="flex gap-2 text-sm">
                              <span className="text-muted-foreground w-48">{textoTramo}</span>
                              <span className="font-semibold">{formatearPrecio(t.precio)}</span>
                              <span className="text-xs text-muted-foreground">Actualizado: {formatearFechaActualizacion(t.updated_at ?? c.updated_at)}</span>
                            </div>
                          );
                        })}
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
                <Label className="text-sm font-medium">Origen</Label>
                <Select value={form.origenTipo} onValueChange={(value) => setForm((f) => ({ ...f, origenTipo: value as 'sucursal' | 'grupo' | 'georef', origenSucursalId: value === 'sucursal' ? f.origenSucursalId : null, origenGrupoId: value === 'grupo' ? f.origenGrupoId : null }))}>
                  <SelectTrigger className="w-full h-9">
                    <SelectValue placeholder="Tipo de origen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sucursal">Sucursal</SelectItem>
                    <SelectItem value="grupo">Grupo de sucursales</SelectItem>
                    <SelectItem value="georef">Georef</SelectItem>
                  </SelectContent>
                </Select>

                {form.origenTipo === 'sucursal' && (
                  <>
                    <Select value={form.origenSucursalId ?? ''} onValueChange={(value) => {
                      const sucursal = sucursales.find((item) => item.id === value);
                      setForm((f) => ({
                        ...f,
                        origenSucursalId: sucursal ? sucursal.id : null,
                        origen: sucursal
                          ? { provincia: sucursal.provincia, localidad: sucursal.localidad, nombre: sucursal.nombre, tipo: 'sucursal', id: sucursal.id }
                          : null,
                      }));
                    }}>
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Seleccionar sucursal de origen" />
                      </SelectTrigger>
                      <SelectContent>
                        {sucursales.map((sucursal) => (
                          <SelectItem key={sucursal.id} value={sucursal.id}>{sucursal.nombre} · {sucursal.localidad}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.origenSucursalId && (
                      <p className="text-xs text-muted-foreground">
                        {sucursales.find((sucursal) => sucursal.id === form.origenSucursalId)?.nombre ?? 'Sucursal'}
                      </p>
                    )}
                  </>
                )}

                {form.origenTipo === 'grupo' && (
                  <>
                    <Select value={form.origenGrupoId ?? ''} onValueChange={(value) => {
                      const grupo = grupos.find((item) => item.id === value);
                      setForm((f) => ({
                        ...f,
                        origenGrupoId: grupo ? grupo.id : null,
                        origen: grupo ? { provincia: f.origen?.provincia ?? '', localidad: f.origen?.localidad ?? null, nombre: grupo.nombre, tipo: 'grupo', id: grupo.id } : null,
                      }));
                    }}>
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Seleccionar grupo de sucursales" />
                      </SelectTrigger>
                      <SelectContent>
                        {grupos.map((grupo) => (
                          <SelectItem key={grupo.id} value={grupo.id}>{grupo.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.origenGrupoId && (
                      <p className="text-xs text-muted-foreground">
                        {grupos.find((grupo) => grupo.id === form.origenGrupoId)?.nombre ?? 'Grupo'}
                      </p>
                    )}
                  </>
                )}

                {form.origenTipo === 'georef' && (
                  <GeorefCombobox
                    label="Origen georef"
                    value={form.origen}
                    onChange={(ubicacion) => setForm((f) => ({ ...f, origen: ubicacion }))}
                    placeholder="Seleccionar provincia..."
                    localidadOpcional
                  />
                )}
              </div>
              <div className="space-y-2">
                <GeorefCombobox label="Destino" value={form.destino} onChange={(v) => setForm((f) => ({ ...f, destino: v }))} localidadOpcional personalizadas={ubicacionesPersonalizadas} />
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
                      <Input type="text" inputMode="decimal" placeholder="Ej: 18.000,50"
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
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="flex items-center gap-1.5"><span className="text-xs font-bold bg-slate-200 text-slate-600 rounded px-1">P</span>Precio por pallet (tramos)</Label>
                <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-2 py-1.5">
                  <Label htmlFor="modo-precio-pallet" className="text-xs text-muted-foreground">Precio x Cantidad Total</Label>
                  <Switch
                    id="modo-precio-pallet"
                    checked={form.modoPrecioPallet === 'precio_total_tramo'}
                    onCheckedChange={(checked) => setForm((f) => ({ ...f, modoPrecioPallet: checked ? 'precio_total_tramo' : 'precio_por_unidad' }))}
                  />
                </div>
              </div>
              <TramoSection
                label=""
                icon={null}
                tramos={form.tramosPallet}
                unidad="pallet"
                paso={0.5}
                onAdd={() => addTramo('tramosPallet')}
                onUpdate={(i, k, v) => updTramo('tramosPallet', i, k, v)}
                onDelete={(i) => delTramo('tramosPallet', i)}
                hint={form.modoPrecioPallet === 'precio_total_tramo'
                  ? 'En este modo, el precio del tramo se usa tal cual como total para esa cantidad de pallets.'
                  : 'En este modo, el precio del tramo se multiplica por la cantidad de pallets pedidas.'}
              />
            </div>

            <Separator />

            {/* Tramos kg */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="flex items-center gap-1.5"><Weight className="h-3.5 w-3.5 text-muted-foreground" />Precio por Kilo (tramos)</Label>
                <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-2.5 py-1.5">
                  <span className={`text-xs ${form.modoUmbralKg === 'desde' ? 'font-semibold text-slate-800' : 'text-muted-foreground'}`}>Desde</span>
                  <Switch
                    id="modo-umbral-kg"
                    checked={form.modoUmbralKg === 'hasta'}
                    onCheckedChange={(checked) => setForm((f) => ({ ...f, modoUmbralKg: checked ? 'hasta' : 'desde' }))}
                  />
                  <span className={`text-xs ${form.modoUmbralKg === 'hasta' ? 'font-semibold text-slate-800' : 'text-muted-foreground'}`}>Hasta</span>
                </div>
              </div>
              <TramoSection
                label=""
                icon={null}
                tramos={form.tramosKg}
                unidad="kg"
                paso={1}
                onAdd={() => addTramo('tramosKg')}
                onUpdate={(i, k, v) => updTramo('tramosKg', i, k, v)}
                onDelete={(i) => delTramo('tramosKg', i)}
                hint=""
              />
              <p className="text-xs text-muted-foreground">
                {form.modoUmbralKg === 'desde'
                  ? 'Modo Desde: a partir del umbral kg en adelante. Toma el tramo con el umbral más alto ≤ al peso.'
                  : 'Modo Hasta: para pesos que no superen el umbral kg. Toma el tramo con el umbral más bajo ≥ al peso (superar el máximo excluye la ruta).'}
              </p>
            </div>

            <Separator />

            {/* Camión completo */}
            <div className="space-y-1.5">
              <Label htmlFor="precio-camion" className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-muted-foreground" />Precio camión completo ($)
              </Label>
              <Input id="precio-camion" type="text" inputMode="decimal" placeholder="Ej: 450.000,00" value={form.precio_camion}
                onChange={(e) => setForm((f) => ({ ...f, precio_camion: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Acepta punto de miles y coma decimal. Dejá vacío si no aplica.</p>
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
                              type="text"
                              inputMode="decimal"
                              placeholder="Ej: 5.000,00"
                              value={precios.bulto}
                              onChange={(e) => {
                                const val = e.target.value;
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
                              type="text"
                              inputMode="decimal"
                              placeholder="Ej: 15.000,00"
                              value={precios.pallet}
                              onChange={(e) => {
                                const val = e.target.value;
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
                              type="text"
                              inputMode="decimal"
                              placeholder="Ej: 8.000,00"
                              value={precios.kg}
                              onChange={(e) => {
                                const val = e.target.value;
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
                              type="text"
                              inputMode="decimal"
                              placeholder="Ej: 50.000,00"
                              value={precios.camion_completo}
                              onChange={(e) => {
                                const val = e.target.value;
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

            {/* Servicios de Transporte */}
            <div>
              <Label className="mb-3 block">Servicios de Transporte</Label>
              {servicios.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay servicios definidos. Creá algunos en el módulo Tags.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {servicios.map((servicio) => {
                      const sel = form.servicioIds.includes(servicio.id);
                      return (
                        <button
                          key={servicio.id}
                          type="button"
                          onClick={() => toggleServicio(servicio.id)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                            sel ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                          }`}
                          aria-pressed={sel}
                        >
                          {sel && <span>✓</span>}{servicio.nombre}
                        </button>
                      );
                    })}
                  </div>

                  {form.servicioIds.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                      {form.servicioIds.map((servicioId) => {
                        const servicio = servicios.find((s) => s.id === servicioId);
                        if (!servicio) return null;
                        return (
                          <div key={servicioId} className="grid grid-cols-[1fr_140px] items-center gap-2 rounded-md border border-slate-200 bg-white p-2.5">
                            <span className="text-xs font-medium text-slate-700">{servicio.nombre}</span>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={form.servicioValores[servicioId] ?? ''}
                              onChange={(e) => setForm((f) => ({
                                ...f,
                                servicioValores: { ...f.servicioValores, [servicioId]: e.target.value },
                              }))}
                              placeholder="$ fijo"
                              className="h-8 text-xs"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <Separator />

            {/* Características de Transporte */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shapes className="h-3.5 w-3.5 text-teal-600" />
                <Label>Características de Transporte</Label>
                <span className="text-xs text-muted-foreground font-normal">(sin costo — solo para filtrar)</span>
              </div>
              {caracteristicas.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay características definidas. Creá algunas en el módulo Tags.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {caracteristicas.map((car) => {
                    const sel = form.caracteristicaIds.includes(car.id);
                    return (
                      <button
                        key={car.id}
                        type="button"
                        onClick={() => toggleCaracteristica(car.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all border-2 ${
                          sel ? 'text-white' : 'bg-white'
                        }`}
                        style={
                          sel
                            ? { backgroundColor: car.color, borderColor: car.color }
                            : { borderColor: car.color, color: car.color }
                        }
                        aria-pressed={sel}
                      >
                        {sel && <span>✓</span>}{car.nombre}
                      </button>
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
  )}
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
              {idx === 0 && <Label className="text-xs text-muted-foreground">{unidad === 'kg' ? 'Umbral (kg)' : `Desde ${unidad} Nº`}</Label>}
              <Input type="number" min={paso} step={paso} placeholder={String(paso)}
                value={tramo.desde} onChange={(e) => onUpdate(idx, 'desde', e.target.value)} />
            </div>
            <div className="flex-1 space-y-1">
              {idx === 0 && <Label className="text-xs text-muted-foreground">Precio por {unidad} ($)</Label>}
              <Input type="text" inputMode="decimal" placeholder="Ej: 90.000,00"
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
