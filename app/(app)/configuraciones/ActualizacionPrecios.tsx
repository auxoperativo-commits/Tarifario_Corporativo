'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { formatearPrecio, formatearUbicacion } from '@/lib/calculos/envios';
import { calcularNuevoPrecio } from '@/lib/calculos/precio-masivo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { aplicarPrecios, cargarInicioActualizacionPrecios, obtenerCatalogoPrecios, obtenerDetalleActualizacion, previsualizarPrecios, revalidarTransportesActivosPrecios, revertirPrecios } from '@/app/actions/actualizaciones-precio';

type Config = {
  id: string; activo: boolean; transporte_id: string; transportes?: { nombre_fantasia?: string; razon_social?: string };
  origen_sucursal_id?: string | null; origen_grupo_id?: string | null;
  modo_umbral_kg?: 'desde' | 'hasta' | null;
  origen_provincia: string; origen_localidad: string | null; origen_nombre_personalizado?: string | null;
  destino_provincia: string; destino_localidad: string | null; destino_nombre_personalizado?: string | null;
};
type TransporteOpcion = { id: string; razon_social: string; nombre_fantasia: string | null };
type Catalogo = { concepto: string; etiqueta: string; tabla: string; columna_precio: string; columna_configuracion_id: string };
type Precio = { concepto: string; etiqueta: string; tabla: string; columna_precio: string; registro_id: string; configuracion_id: string; precio_anterior: number; precio_nuevo: number; diferencia: number; variacion_porcentual: number | null };
type PrecioEjemplo = { configuracion_id: string; concepto: string; etiqueta: string; precio: number };
type Historial = { id: string; tipo_ajuste: string; valor: number; redondeo: number; conceptos: string[]; nota: string | null; cantidad_configuraciones: number; cantidad_precios_modificados: number; created_at: string; revertida_at: string | null; perfiles_usuario?: { nombre_completo: string | null } | null; actualizaciones_precio_detalle?: Precio[] };

const PAGE_SIZE = 50;
const TRANSPORTES_CACHE_TTL_MS = 5 * 60 * 1000;
const CONFIGURACIONES_CACHE_TTL_MS = 5 * 60 * 1000;
let cacheTransportesActivos: { data: TransporteOpcion[]; buscarEnServidor: boolean; updatedAt: number } | null = null;
const cacheConfiguraciones = new Map<string, { data: Config[]; updatedAt: number }>();
const LABELS: Record<string, string> = { bultos: 'Bultos', pallets: 'Pallets', kg: 'Kg', camion_completo: 'Camión completo', servicios: 'Servicios de transporte', tags: 'Tags con valor' };

export function ActualizacionPrecios() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<Config[]>([]);
  const [transportesElegidos, setTransportesElegidos] = useState<TransporteOpcion[]>([]);
  const transportesElegidosRef = useRef(new Set<string>());
  const [transportesActivos, setTransportesActivos] = useState<TransporteOpcion[]>(cacheTransportesActivos?.data ?? []);
  const [buscarEnServidor, setBuscarEnServidor] = useState(cacheTransportesActivos?.buscarEnServidor ?? false);
  const [cargandoTransportes, setCargandoTransportes] = useState(!cacheTransportesActivos);
  const revalidandoTransportesRef = useRef(false);
  const [busquedaTransporte, setBusquedaTransporte] = useState('');
  const [sugerenciasTransporte, setSugerenciasTransporte] = useState<TransporteOpcion[]>([]);
  const [buscandoTransportes, setBuscandoTransportes] = useState(false);
  const [transportesError, setTransportesError] = useState<string | null>(null);
  const [configuracionesCargando, setConfiguracionesCargando] = useState<Set<string>>(new Set());
  const [configuracionesError, setConfiguracionesError] = useState<string | null>(null);
  const [origenes, setOrigenes] = useState<Record<string, string>>({});
  const [catalogo, setCatalogo] = useState<Catalogo[]>([]);
  const [catalogoError, setCatalogoError] = useState<string | null>(null);
  const [preciosEjemplo, setPreciosEjemplo] = useState<PrecioEjemplo[]>([]);
  const [preciosEjemploError, setPreciosEjemploError] = useState<string | null>(null);
  const [cargandoEjemplo, setCargandoEjemplo] = useState(false);
  const [ejemploId, setEjemploId] = useState('');
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [catalogoCargando, setCatalogoCargando] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paso, setPaso] = useState(1);
  const [page, setPage] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detalle, setDetalle] = useState<Historial | null>(null);
  const [conflictos, setConflictos] = useState<unknown[]>([]);
  const [filtros, setFiltros] = useState({ origen: '', destino: '' });
  const [incluirInactivas, setIncluirInactivas] = useState(false);
  const [tipo, setTipo] = useState<'porcentaje' | 'monto_fijo'>('porcentaje');
  const [direccion, setDireccion] = useState<'aumentar' | 'disminuir'>('aumentar');
  const [valor, setValor] = useState('');
  const [redondeo, setRedondeo] = useState('0');
  const [conceptos, setConceptos] = useState<string[]>([]);
  const [nota, setNota] = useState('');
  const [preview, setPreview] = useState<{ items: Precio[]; cantidad_configuraciones: number; cantidad_precios: number; bloqueantes: number; advertencias: number } | null>(null);
  const supabase = createClient();

  async function cargarCatalogo() {
    setCatalogoCargando(true);
    const cat = await obtenerCatalogoPrecios();
    if (cat.error) {
      setCatalogo([]);
      setCatalogoError(cat.error);
    } else {
      const filas = (cat.data ?? []) as Catalogo[];
      setCatalogo(filas);
      setCatalogoError(filas.length ? null : 'El catálogo está vacío. Aplicá la migración de seed de conceptos de precio.');
    }
    setCatalogoCargando(false);
    return cat.error ? null : ((cat.data ?? []) as Catalogo[]);
  }

  async function cargar() {
    setLoading(true);
    setTransportesError(null);
    const ahora = Date.now();
    const cacheVigente = cacheTransportesActivos && ahora - cacheTransportesActivos.updatedAt < TRANSPORTES_CACHE_TTL_MS;
    const incluirTransportes = !cacheVigente;
    if (cacheTransportesActivos) {
      setTransportesActivos(cacheTransportesActivos.data);
      setBuscarEnServidor(cacheTransportesActivos.buscarEnServidor);
      setCargandoTransportes(false);
    } else {
      setCargandoTransportes(true);
    }

    const inicial = await cargarInicioActualizacionPrecios(incluirTransportes);
    if (inicial.error) {
      setCatalogoError(inicial.error);
      setCatalogoCargando(false);
      if (!cacheTransportesActivos) setCargandoTransportes(false);
      setTransportesError(inicial.error);
      toast({ variant: 'destructive', title: inicial.error });
    } else if (inicial.data) {
      const filasCatalogo = inicial.data.catalogo as Catalogo[];
      setCatalogo(filasCatalogo);
      setCatalogoError(filasCatalogo.length ? null : 'El catálogo está vacío. Aplicá la migración de seed de conceptos de precio.');
      setCatalogoCargando(false);
      setHistorial(inicial.data.historial as Historial[]);
      if (!incluirTransportes) setTransportesError(null);
      if (incluirTransportes) {
        const filasTransportes = (inicial.data.transportes ?? []) as TransporteOpcion[];
        const usarServidor = filasTransportes.length > 1000;
        const nuevaCache = { data: usarServidor ? [] : filasTransportes, buscarEnServidor: usarServidor, updatedAt: Date.now() };
        cacheTransportesActivos = nuevaCache;
        setTransportesActivos(nuevaCache.data);
        setBuscarEnServidor(nuevaCache.buscarEnServidor);
        setCargandoTransportes(false);
        setTransportesError(null);
      }
    }
    const [{ data: sucursales }, { data: grupos }] = await Promise.all([
      supabase.from('sucursales').select('id, nombre'),
      supabase.from('grupos_sucursales').select('id, nombre'),
    ]);
    setOrigenes(Object.fromEntries([...(sucursales ?? []), ...(grupos ?? [])].map((item) => [item.id, item.nombre])));
    setLoading(false);
  }

  useEffect(() => { void cargar(); }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (revalidandoTransportesRef.current || !cacheTransportesActivos || Date.now() - cacheTransportesActivos.updatedAt < TRANSPORTES_CACHE_TTL_MS) return;
      revalidandoTransportesRef.current = true;
      try {
        const result = await revalidarTransportesActivosPrecios();
        if (result.error) {
          setTransportesError(result.error);
          return;
        }
        const filas = (result.data?.transportes ?? []) as TransporteOpcion[];
        const nuevaCache = { data: filas.length > 1000 ? [] : filas, buscarEnServidor: filas.length > 1000, updatedAt: Date.now() };
        cacheTransportesActivos = nuevaCache;
        setTransportesActivos(nuevaCache.data);
        setBuscarEnServidor(nuevaCache.buscarEnServidor);
        setTransportesError(null);
      } catch (error) {
        setTransportesError(error instanceof Error ? error.message : 'No se pudieron actualizar los transportes.');
      } finally {
        revalidandoTransportesRef.current = false;
      }
    }, TRANSPORTES_CACHE_TTL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const texto = busquedaTransporte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').trim();
    setTransportesError(null);
    if (!texto) {
      setSugerenciasTransporte([]);
      setBuscandoTransportes(false);
      return;
    }
    if (cargandoTransportes) {
      setSugerenciasTransporte([]);
      setBuscandoTransportes(false);
      return;
    }

    if (!buscarEnServidor) {
      const elegidos = new Set(transportesElegidos.map((item) => item.id));
      const resultados = transportesActivos.flatMap((item) => {
        if (elegidos.has(item.id)) return [];
        const razon = item.razon_social.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');
        const fantasia = (item.nombre_fantasia ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');
        const nombreVisible = item.nombre_fantasia || item.razon_social;
        const empieza = razon.startsWith(texto) || fantasia.startsWith(texto);
        return razon.includes(texto) || fantasia.includes(texto)
          ? [{ item, nombreVisible, empieza }]
          : [];
      }).sort((a, b) => Number(b.empieza) - Number(a.empieza) || a.nombreVisible.localeCompare(b.nombreVisible, 'es-AR'));
      setSugerenciasTransporte(resultados.slice(0, 10).map(({ item }) => item));
      setBuscandoTransportes(false);
      return;
    }

    // Con más de 1.000 transportes activos se usa la búsqueda SQL en vez de filtrar una lista grande en el cliente.
    const controller = new AbortController();
    let vigente = true;
    setSugerenciasTransporte([]);
    setBuscandoTransportes(true);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('buscar_transportes_actualizacion_precios', {
        p_busqueda: busquedaTransporte.trim(),
      }).abortSignal(controller.signal);
      if (!vigente || controller.signal.aborted) return;
      setBuscandoTransportes(false);
      if (error) {
        setSugerenciasTransporte([]);
        setTransportesError(error.message);
      } else {
        const elegidos = new Set(transportesElegidos.map((item) => item.id));
        setSugerenciasTransporte(((data ?? []) as TransporteOpcion[]).filter((item) => !elegidos.has(item.id)).slice(0, 10));
      }
    }, 200);
    return () => {
      vigente = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [busquedaTransporte, buscarEnServidor, cargandoTransportes, transportesActivos, transportesElegidos, supabase]);

  const filtered = useMemo(() => configs.filter((c) => {
    const origen = `${c.origen_provincia} ${c.origen_localidad ?? ''} ${c.origen_nombre_personalizado ?? ''} ${origenes[c.origen_sucursal_id ?? ''] ?? ''} ${origenes[c.origen_grupo_id ?? ''] ?? ''}`.toLocaleLowerCase();
    const destino = `${c.destino_provincia} ${c.destino_localidad ?? ''} ${c.destino_nombre_personalizado ?? ''}`.toLocaleLowerCase();
    return (incluirInactivas || c.activo) && origen.includes(filtros.origen.toLocaleLowerCase()) && destino.includes(filtros.destino.toLocaleLowerCase());
  }), [configs, filtros, incluirInactivas, origenes]);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const previewGroups = useMemo(() => {
    const groups = new Map<string, { configuracionId: string; items: Precio[] }>();
    for (const item of preview?.items ?? []) {
      const group = groups.get(item.configuracion_id) ?? { configuracionId: item.configuracion_id, items: [] };
      group.items.push(item);
      groups.set(item.configuracion_id, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.concepto.localeCompare(b.concepto) || a.etiqueta.localeCompare(b.etiqueta)),
    }));
  }, [preview]);

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function seleccionarTransporte(transporte: TransporteOpcion) {
    if (transportesElegidosRef.current.has(transporte.id)) return;
    transportesElegidosRef.current.add(transporte.id);
    setTransportesElegidos((prev) => [...prev, transporte]);
    setPage(0);
    setBusquedaTransporte('');
    setSugerenciasTransporte([]);
    setConfiguracionesError(null);
    const guardadas = cacheConfiguraciones.get(transporte.id);
    if (guardadas && Date.now() - guardadas.updatedAt < CONFIGURACIONES_CACHE_TTL_MS) {
      setConfigs((prev) => [...prev, ...guardadas.data.filter((item) => !prev.some((existing) => existing.id === item.id))]);
      return;
    }
    setConfiguracionesCargando((prev) => new Set(prev).add(transporte.id));
    const filas: Config[] = [];
    try {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('configuraciones_envio')
          .select('id, activo, transporte_id, origen_sucursal_id, origen_grupo_id, origen_provincia, origen_localidad, origen_nombre_personalizado, destino_provincia, destino_localidad, destino_nombre_personalizado, modo_umbral_kg')
          .eq('transporte_id', transporte.id).order('created_at', { ascending: false }).range(from, from + 999);
        if (error) throw new Error(error.message);
        filas.push(...((data ?? []) as Config[]));
        if (!data || data.length < 1000) break;
      }
      cacheConfiguraciones.set(transporte.id, { data: filas, updatedAt: Date.now() });
      if (transportesElegidosRef.current.has(transporte.id)) setConfigs((prev) => {
        const existentes = new Set(prev.map((item) => item.id));
        return [...prev, ...filas.filter((item) => !existentes.has(item.id))];
      });
    } catch (error) {
      setConfiguracionesError(error instanceof Error ? error.message : 'No se pudieron cargar las configuraciones.');
    } finally {
      setConfiguracionesCargando((prev) => { const next = new Set(prev); next.delete(transporte.id); return next; });
    }
  }

  function quitarTransporte(transporteId: string) {
    transportesElegidosRef.current.delete(transporteId);
    setPage(0);
    setTransportesElegidos((prev) => prev.filter((item) => item.id !== transporteId));
    const ids = new Set(configs.filter((item) => item.transporte_id === transporteId).map((item) => item.id));
    setConfigs((prev) => prev.filter((item) => item.transporte_id !== transporteId));
    setSelected((prev) => new Set(Array.from(prev).filter((id) => !ids.has(id))));
  }

  async function cargarPreciosSeleccionados(ids: string[], catalogoActual: Catalogo[] = catalogo) {
    setPreciosEjemplo([]);
    setPreciosEjemploError(null);
    setEjemploId(ids[0] ?? '');
    if (!ids.length || !catalogoActual.length) return;

    setCargandoEjemplo(true);
    const porTabla = new Map<string, Catalogo[]>();
    for (const campo of catalogoActual) porTabla.set(campo.tabla, [...(porTabla.get(campo.tabla) ?? []), campo]);
    const filasCargadas: Array<{ campo: Catalogo; fila: Record<string, unknown> }> = [];
    const dynamicClient = supabase as unknown as { from: (table: string) => {
      select: (columns: string) => { in: (column: string, values: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> };
    } };
    const metadatos: Record<string, string[]> = {
      tarifas_bulto: ['desde_bulto'], tarifas_pallet: ['desde_pallet'], tarifas_kg: ['umbral_kg'],
      configuracion_servicios: ['servicio_id'], configuracion_tag_precios: ['tag_id'],
    };
    for (const [tabla, campos] of Array.from(porTabla.entries())) {
      const columnaConfig = campos[0].columna_configuracion_id;
      const columnas = Array.from(new Set(['id', columnaConfig, ...campos.map((campo) => campo.columna_precio), ...(metadatos[tabla] ?? [])]));
      for (let offset = 0; offset < ids.length; offset += 500) {
        const { data, error } = await dynamicClient.from(tabla).select(columnas.join(',')).in(columnaConfig, ids.slice(offset, offset + 500));
        if (error) {
          setPreciosEjemploError(`No se pudieron cargar los precios de ejemplo: ${error.message}`);
          setCargandoEjemplo(false);
          return;
        }
        for (const fila of data ?? []) for (const campo of campos) filasCargadas.push({ campo, fila });
      }
    }

    const servicioIds = Array.from(new Set(filasCargadas.filter((x) => x.campo.tabla === 'configuracion_servicios').map((x) => String(x.fila.servicio_id))));
    const tagIds = Array.from(new Set(filasCargadas.filter((x) => x.campo.tabla === 'configuracion_tag_precios').map((x) => String(x.fila.tag_id))));
    const [{ data: servicios, error: errorServicios }, { data: tags, error: errorTags }] = await Promise.all([
      servicioIds.length ? supabase.from('servicios_transporte').select('id, nombre').in('id', servicioIds) : Promise.resolve({ data: [], error: null }),
      tagIds.length ? supabase.from('tags').select('id, nombre').in('id', tagIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (errorServicios || errorTags) {
      setPreciosEjemploError(`No se pudieron cargar los nombres de servicios o tags: ${errorServicios?.message ?? errorTags?.message}`);
      setCargandoEjemplo(false);
      return;
    }
    const nombresServicios = new Map((servicios ?? []).map((x) => [x.id, x.nombre]));
    const nombresTags = new Map((tags ?? []).map((x) => [x.id, x.nombre]));
    const ejemplos: PrecioEjemplo[] = [];
    for (const { campo, fila } of filasCargadas) {
      const raw = fila[campo.columna_precio];
      if (raw === null || raw === undefined) continue;
      const configId = campo.columna_configuracion_id === 'id' ? String(fila.id) : String(fila[campo.columna_configuracion_id]);
      let etiqueta = campo.etiqueta;
      if (campo.tabla === 'tarifas_bulto') etiqueta = `Bulto (tramo desde ${fila.desde_bulto} bultos)`;
      if (campo.tabla === 'tarifas_pallet') etiqueta = `Pallet (tramo desde ${fila.desde_pallet} pallets)`;
      if (campo.tabla === 'tarifas_kg') {
        const config = configs.find((x) => x.id === configId);
        etiqueta = `Kg (${config?.modo_umbral_kg === 'hasta' ? 'hasta' : 'desde'} ${fila.umbral_kg} kg)`;
      }
      if (campo.tabla === 'configuracion_servicios') etiqueta = `Servicio: ${nombresServicios.get(String(fila.servicio_id)) ?? 'Servicio'}`;
      if (campo.tabla === 'configuracion_tag_precios') {
        const unidad = ({ precio_bulto: 'Bulto', precio_pallet: 'Pallet', precio_kg: 'Kg', precio_camion_completo: 'Camión completo' } as Record<string, string>)[campo.columna_precio] ?? campo.columna_precio;
        etiqueta = `Tag: ${nombresTags.get(String(fila.tag_id)) ?? 'Tag'} · ${unidad}`;
      }
      if (campo.tabla === 'configuraciones_envio' && campo.columna_precio === 'precio_pallet') etiqueta = 'Pallet (precio fijo)';
      if (campo.columna_precio === 'precio_camion_completo' && campo.tabla === 'configuraciones_envio') etiqueta = 'Camión completo';
      ejemplos.push({ configuracion_id: configId, concepto: campo.concepto, etiqueta, precio: Number(raw) });
    }
    setPreciosEjemplo(ejemplos);
    setCargandoEjemplo(false);
  }

  async function entrarPasoDos() {
    const ids = Array.from(selected);
    setPaso(2);
    await cargarPreciosSeleccionados(ids);
  }

  async function reintentarCargaConceptos() {
    const filas = await cargarCatalogo();
    if (filas?.length) await cargarPreciosSeleccionados(Array.from(selected), filas);
  }

  const conceptosDisponibles = useMemo(() => Array.from(new Set(catalogo.map((x) => x.concepto))), [catalogo]);
  const cantidadPorConcepto = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of preciosEjemplo) result.set(item.concepto, (result.get(item.concepto) ?? 0) + 1);
    return result;
  }, [preciosEjemplo]);
  const valorNumerico = Number(valor);
  const valorValido = valor.trim() !== '' && Number.isFinite(valorNumerico) && valorNumerico > 0;
  const valorFirmado = direccion === 'aumentar' ? valorNumerico : -valorNumerico;
  const ajusteListo = conceptos.length > 0 && valorValido && !cargandoEjemplo && !preciosEjemploError;
  const calculosGlobales = useMemo(() => {
    if (!ajusteListo) return [];
    return preciosEjemplo.filter((item) => conceptos.includes(item.concepto)).map((item) => ({
      ...item,
      nuevo: calcularNuevoPrecio(item.precio, tipo, valorFirmado, Number(redondeo) as 0 | 1 | 10 | 100 | 1000),
    })).filter((item) => item.nuevo !== item.precio);
  }, [ajusteListo, preciosEjemplo, conceptos, tipo, valorFirmado, redondeo]);
  const calculosEjemplo = useMemo(() => calculosGlobales.filter((item) => item.configuracion_id === ejemploId), [calculosGlobales, ejemploId]);
  const configsConCambios = useMemo(() => new Set(calculosGlobales.map((item) => item.configuracion_id)).size, [calculosGlobales]);
  const bloqueantesLive = calculosGlobales.filter((item) => item.nuevo <= 0).length;
  const advertenciasLive = calculosGlobales.filter((item) => item.precio === 0 || Math.abs(((item.nuevo / item.precio) - 1) * 100) > 50).length;
  const errorConceptos = catalogoError || (!catalogo.length ? 'No se pudieron cargar los conceptos de precio' : null);
  const mensajeValor = !valor.trim() ? 'Ingresá un valor mayor a cero.' : (!Number.isFinite(valorNumerico) || valorNumerico <= 0 ? 'El valor debe ser un número mayor a cero.' : null);
  const mensajeConceptos = conceptos.length ? null : 'Elegí al menos un concepto a modificar.';
  const mensajePrecios = !cargandoEjemplo && !preciosEjemploError && conceptos.length > 0 && valorValido && calculosGlobales.length === 0
    ? 'No hay precios para modificar con esta selección.' : null;
  const motivoPreviewDeshabilitado = errorConceptos ? 'No se pudo cargar el catálogo de conceptos.'
    : !selected.size ? 'Volvé y seleccioná al menos una configuración.'
      : mensajeConceptos ?? mensajeValor ?? (preciosEjemploError ? 'No se pudieron cargar los precios de ejemplo.' : null)
        ?? (cargandoEjemplo ? 'Esperá a que terminen de cargar los precios de ejemplo.' : null)
          ?? (bloqueantesLive ? 'Corregí el ajuste: hay precios que quedarían en cero o negativos.' : null)
            ?? (mensajePrecios ?? null);
  const puedeVerPreview = !saving && !motivoPreviewDeshabilitado && calculosGlobales.length > 0;

  async function generarPreview() {
    if (!puedeVerPreview) return;
    const n = Number(valor);
    setSaving(true);
    const result = await previsualizarPrecios({ configuracionIds: Array.from(selected), tipo, valor: direccion === 'aumentar' ? n : -n, redondeo: Number(redondeo), conceptos, incluirInactivas });
    setSaving(false);
    if (result.error) { toast({ variant: 'destructive', title: result.error }); return; }
    setPreview(result.data as typeof preview);
    setPaso(3);
  }

  async function aplicar() {
    if (!preview) return;
    setSaving(true);
    const result = await aplicarPrecios({ configuracionIds: Array.from(selected), tipo, valor: direccion === 'aumentar' ? Number(valor) : -Number(valor), redondeo: Number(redondeo), conceptos, incluirInactivas, nota });
    setSaving(false); setConfirmOpen(false);
    if (result.error) { toast({ variant: 'destructive', title: result.error }); return; }
    toast({ title: 'Actualización aplicada', description: `Se modificaron ${preview.cantidad_precios} precios.` });
    setPaso(1); setPreview(null); setSelected(new Set()); await cargar();
  }

  async function deshacer(item: Historial) {
    setSaving(true); const result = await revertirPrecios(item.id); setSaving(false);
    if (result.error) { toast({ variant: 'destructive', title: result.error }); return; }
    const data = result.data as { ok: boolean; conflictos?: unknown[] };
    if (!data.ok) { setConflictos(data.conflictos ?? []); return; }
    toast({ title: 'Actualización revertida.' }); await cargar();
  }

  async function toggleDetalle(item: Historial) {
    if (detalle?.id === item.id) { setDetalle(null); return; }
    setDetalle({ ...item, actualizaciones_precio_detalle: [] });
    const result = await obtenerDetalleActualizacion(item.id);
    if (result.error) { toast({ variant: 'destructive', title: result.error }); return; }
    setDetalle((current) => current?.id === item.id ? { ...current, actualizaciones_precio_detalle: result.data as Precio[] } : current);
  }

  const fmtDate = (value: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const ubicacion = (c: Config, side: 'origen' | 'destino') => {
    const provincia = side === 'origen' ? c.origen_provincia : c.destino_provincia;
    const localidad = side === 'origen' ? c.origen_localidad : c.destino_localidad;
    const custom = side === 'origen' ? c.origen_nombre_personalizado : c.destino_nombre_personalizado;
    const originRef = side === 'origen' ? (c.origen_sucursal_id ?? c.origen_grupo_id) : null;
    const nombre = custom || (originRef ? origenes[originRef] : null);
    return nombre ? `${provincia} (${nombre})${localidad ? ` · ${localidad}` : ''}` : formatearUbicacion({ provincia, localidad });
  };
  const etiquetaConfiguracion = (id: string) => {
    const config = configs.find((item) => item.id === id);
    if (!config) return id;
    const transporte = transportesElegidos.find((item) => item.id === config.transporte_id);
    return `${transporte?.nombre_fantasia || transporte?.razon_social || 'Transporte'} · ${ubicacion(config, 'origen')} → ${ubicacion(config, 'destino')}`;
  };
  const transporteNombre = (id: string) => {
    const transporte = transportesElegidos.find((item) => item.id === id);
    return transporte?.nombre_fantasia || transporte?.razon_social || 'Transporte';
  };
  const bloqueadoPasoDos = cargandoEjemplo || catalogoCargando || Boolean(preciosEjemploError) || Boolean(errorConceptos);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2">{[1, 2, 3].map((n) => <Badge key={n} variant={paso === n ? 'default' : 'secondary'}>Paso {n}</Badge>)}<span className="text-sm text-muted-foreground">{selected.size} configuraciones seleccionadas</span></div>

    {paso === 1 && <Card><CardHeader><CardTitle>Seleccionar configuraciones</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="buscar-transporte-precios">Transporte</Label>
        <Input id="buscar-transporte-precios" role="combobox" aria-expanded={busquedaTransporte.trim().length >= 1} aria-controls="sugerencias-transportes-precios" aria-autocomplete="list" autoComplete="off" value={busquedaTransporte} onChange={(e) => setBusquedaTransporte(e.target.value)} placeholder={cargandoTransportes ? 'Cargando transportes...' : 'Buscá un transporte para empezar'} />
        {cargandoTransportes && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando transportes...</p>}
        {buscandoTransportes && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando...</p>}
        {transportesError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{transportesError}</p><Button type="button" variant="outline" size="sm" onClick={() => void cargar()}>Reintentar carga</Button></div>}
        {!buscandoTransportes && !transportesError && busquedaTransporte.trim().length >= 1 && sugerenciasTransporte.length === 0 && <p className="text-sm text-muted-foreground">Sin resultados</p>}
        {sugerenciasTransporte.length > 0 && <ul id="sugerencias-transportes-precios" role="listbox" className="max-h-52 overflow-auto rounded-md border">{sugerenciasTransporte.map((item) => <li key={item.id} role="option" aria-selected="false"><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => void seleccionarTransporte(item)}>{item.nombre_fantasia || item.razon_social}{item.nombre_fantasia && <span className="ml-2 text-muted-foreground">{item.razon_social}</span>}</button></li>)}</ul>}
        {transportesElegidos.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Transportes elegidos">{transportesElegidos.map((item) => <Badge key={item.id} variant="secondary" className="gap-2 py-1">{item.nombre_fantasia || item.razon_social}<button type="button" aria-label={`Quitar ${item.nombre_fantasia || item.razon_social}`} className="rounded-full hover:text-destructive" onClick={() => quitarTransporte(item.id)}>×</button></Badge>)}</div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Origen (sucursal o grupo)</Label><Input value={filtros.origen} onChange={(e) => { setPage(0); setFiltros({ ...filtros, origen: e.target.value }); }} placeholder="Provincia, localidad o nombre" /></div>
        <div><Label>Destino</Label><Input value={filtros.destino} onChange={(e) => { setPage(0); setFiltros({ ...filtros, destino: e.target.value }); }} placeholder="Provincia, localidad o ubicación" /></div>
      </div>
      <div className="flex items-center gap-2"><Switch checked={incluirInactivas} onCheckedChange={setIncluirInactivas} id="inactivas" /><Label htmlFor="inactivas">Incluir configuraciones inactivas</Label></div>
      {configuracionesCargando.size > 0 && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando configuraciones...</p>}
      <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50 text-left"><th className="p-3"><input type="checkbox" disabled={configuracionesCargando.size > 0} checked={allFilteredSelected} onChange={toggleAll} aria-label="Seleccionar todas las configuraciones filtradas" /></th><th className="p-3">Transporte</th><th className="p-3">Origen</th><th className="p-3">Destino</th><th className="p-3">Estado</th></tr></thead><tbody>
        {visible.map((c) => <tr key={c.id} className="border-b last:border-0"><td className="p-3"><input type="checkbox" disabled={configuracionesCargando.size > 0} checked={selected.has(c.id)} onChange={() => setSelected((prev) => { const next = new Set(prev); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next; })} /></td><td className="p-3">{transporteNombre(c.transporte_id)}</td><td className="p-3">{ubicacion(c, 'origen')}</td><td className="p-3">{ubicacion(c, 'destino')}</td><td className="p-3"><Badge variant={c.activo ? 'secondary' : 'outline'}>{c.activo ? 'Activa' : 'Inactiva'}</Badge></td></tr>)}
        {!visible.length && <tr><td className="p-5 text-center text-muted-foreground" colSpan={5}>{configuracionesCargando.size ? 'Cargando configuraciones...' : transportesElegidos.length ? 'No hay configuraciones para estos filtros.' : 'Buscá un transporte para empezar.'}</td></tr>}
      </tbody></table></div>
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{filtered.length} configuraciones encontradas</span><div className="flex gap-2"><Button variant="outline" disabled={!page} onClick={() => setPage((p) => p - 1)}>Anterior</Button><Button variant="outline" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage((p) => p + 1)}>Siguiente</Button></div></div>
      <div>{configuracionesError && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las configuraciones: {configuracionesError}</p>}<div className="flex justify-end"><Button disabled={!selected.size || configuracionesCargando.size > 0} onClick={() => void entrarPasoDos()}>Definir ajuste</Button></div></div>
    </CardContent></Card>}

    {paso === 2 && <Card><CardHeader><CardTitle>Definir el ajuste</CardTitle></CardHeader><CardContent className="space-y-5">
      <section className="space-y-2">
        <Label>Conceptos a modificar</Label>
        {(catalogoCargando || cargandoEjemplo) ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando conceptos...</p> : errorConceptos || preciosEjemploError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><strong>No se pudieron cargar los conceptos de precio.</strong><div className="mt-1">{catalogoError || preciosEjemploError}</div><Button type="button" variant="outline" size="sm" className="mt-2" disabled={catalogoCargando || cargandoEjemplo} onClick={() => void reintentarCargaConceptos()}>Reintentar</Button></div> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{conceptosDisponibles.map((concepto) => {
          const cantidad = cantidadPorConcepto.get(concepto) ?? 0;
          return <label key={concepto} className="flex cursor-pointer items-center gap-2 rounded border p-3"><input type="checkbox" disabled={bloqueadoPasoDos || cantidad === 0} checked={conceptos.includes(concepto)} onChange={() => setConceptos((prev) => prev.includes(concepto) ? prev.filter((x) => x !== concepto) : [...prev, concepto])} /><span>{LABELS[concepto] ?? catalogo.find((x) => x.concepto === concepto)?.etiqueta ?? concepto} · {cantidad} precios{cantidad === 0 && <span className="block text-xs text-muted-foreground">Las configuraciones elegidas no tienen precios de este tipo.</span>}</span></label>;
        })}</div>}
        {mensajeConceptos && !errorConceptos && <p className="text-sm text-destructive">{mensajeConceptos}</p>}
      </section>

      <section className="space-y-3">
        <Label>Ajuste</Label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="tipo-ajuste">Tipo</Label><Select disabled={bloqueadoPasoDos} value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}><SelectTrigger id="tipo-ajuste"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="porcentaje">Porcentaje</SelectItem><SelectItem value="monto_fijo">Monto fijo</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor="direccion-ajuste">Dirección</Label><Select disabled={bloqueadoPasoDos} value={direccion} onValueChange={(v) => setDireccion(v as typeof direccion)}><SelectTrigger id="direccion-ajuste"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="aumentar">Aumentar</SelectItem><SelectItem value="disminuir">Disminuir</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor="valor-ajuste">Valor positivo</Label><Input disabled={bloqueadoPasoDos} id="valor-ajuste" type="number" min="0" step="any" value={valor} onChange={(e) => setValor(e.target.value)} aria-invalid={!!mensajeValor} /><p className="mt-1 min-h-5 text-sm text-destructive">{mensajeValor}</p></div>
          <div><Label htmlFor="redondeo-ajuste">Redondeo</Label><Select disabled={bloqueadoPasoDos} value={redondeo} onValueChange={setRedondeo}><SelectTrigger id="redondeo-ajuste"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Sin redondeo</SelectItem><SelectItem value="1">Al múltiplo de 1</SelectItem><SelectItem value="10">Al múltiplo de 10</SelectItem><SelectItem value="100">Al múltiplo de 100</SelectItem><SelectItem value="1000">Al múltiplo de 1.000</SelectItem></SelectContent></Select></div>
        </div>
      </section>

      <Card className="border-slate-200"><CardHeader className="pb-3"><CardTitle className="text-lg">Así quedarían los precios</CardTitle></CardHeader><CardContent className="space-y-3">
        {selected.size > 1 && <div className="max-w-2xl"><Label htmlFor="config-ejemplo">Ver ejemplo de:</Label><Select disabled={bloqueadoPasoDos} value={ejemploId} onValueChange={setEjemploId}><SelectTrigger id="config-ejemplo"><SelectValue /></SelectTrigger><SelectContent>{Array.from(selected).map((id) => <SelectItem key={id} value={id}>{etiquetaConfiguracion(id)}</SelectItem>)}</SelectContent></Select></div>}
        {cargandoEjemplo ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando conceptos...</p> : preciosEjemploError ? <p role="alert" className="text-sm text-destructive">{preciosEjemploError}</p> : !conceptos.length || !valorValido ? <p className="text-sm text-muted-foreground">Marcá un concepto e ingresá un valor para ver cómo quedan los precios.</p> : <>
          <p className="text-sm font-medium">Se modificarán {calculosGlobales.length} precios en {configsConCambios} configuraciones.</p>
          {bloqueantesLive > 0 && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm font-medium text-red-700">{bloqueantesLive} precio(s) quedarían en cero o negativos. Corregí el ajuste antes de continuar.</p>}
          {advertenciasLive > 0 && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">Advertencia: {advertenciasLive} variación(es) superan el 50% o parten de cero.</p>}
          {!calculosEjemplo.length && <p className="text-sm text-muted-foreground">Esta configuración de ejemplo no tiene precios en los conceptos marcados.</p>}
          <div className="divide-y rounded-md border">{calculosEjemplo.map((item, index) => {
            const variacion = item.precio === 0 ? null : ((item.nuevo / item.precio) - 1) * 100;
            const diferencia = item.nuevo - item.precio;
            const direccionClass = item.nuevo <= 0 ? 'text-red-700' : direccion === 'aumentar' ? 'text-emerald-700' : 'text-red-700';
            return <div key={`${item.concepto}-${item.etiqueta}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{item.etiqueta}</span>
              <span className="flex flex-wrap items-center gap-x-2"><span>{formatearPrecio(item.precio)}</span><span>→</span><span className={`${direccionClass} ${item.nuevo <= 0 ? 'font-bold' : 'font-semibold'}`}>{formatearPrecio(item.nuevo)}</span><span className={direccionClass}>({diferencia > 0 ? '+' : diferencia < 0 ? '−' : ''}{formatearPrecio(Math.abs(diferencia))} · {variacion === null ? '—' : `${variacion > 0 ? '+' : ''}${variacion.toFixed(2)}%`})</span></span>
            </div>;
          })}</div>
        </>}
      </CardContent></Card>

      <div><Label htmlFor="nota-ajuste">Nota o motivo (opcional)</Label><Input disabled={bloqueadoPasoDos} id="nota-ajuste" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: Aumento Oct 2026 según carta del transporte" /></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={() => setPaso(1)}>Volver a selección</Button><div className="text-right"><Button disabled={!puedeVerPreview} onClick={() => void generarPreview()}>{saving ? 'Calculando…' : 'Ver vista previa'}</Button>{!puedeVerPreview && <p className="mt-1 max-w-md text-sm text-muted-foreground">{motivoPreviewDeshabilitado ?? 'No hay precios que modificar.'}</p>}</div></div>
    </CardContent></Card>}

    {paso === 3 && preview && <Card><CardHeader><CardTitle>Vista previa: antes → después</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-3"><Badge variant="secondary">{preview.cantidad_configuraciones} configuraciones</Badge><Badge variant="secondary">{preview.cantidad_precios} precios</Badge>{preview.bloqueantes > 0 && <Badge variant="destructive">{preview.bloqueantes} precios cero o negativos</Badge>}{preview.advertencias > 0 && <Badge variant="outline">{preview.advertencias} variaciones mayores al 50%</Badge>}</div>
      <div className="max-h-[55vh] overflow-auto rounded-md border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr className="text-left"><th className="p-3">Configuración / concepto</th><th className="p-3">Campo</th><th className="p-3">Antes → después</th><th className="p-3">Diferencia</th><th className="p-3">Variación</th></tr></thead><tbody>{previewGroups.flatMap((group) => {
        const c = configs.find((x) => x.id === group.configuracionId);
        const title = <tr className="border-t bg-muted/40" key={`config-${group.configuracionId}`}><td className="p-3 font-medium" colSpan={5}>{c ? transporteNombre(c.transporte_id) : 'Transporte'}<div className="text-xs font-normal text-muted-foreground">{c ? `${ubicacion(c, 'origen')} → ${ubicacion(c, 'destino')}` : group.configuracionId}</div></td></tr>;
        let lastConcept = '';
        const rows = group.items.map((p) => {
          const showConcept = p.concepto !== lastConcept;
          lastConcept = p.concepto;
          const precioCalculadoCliente = calcularNuevoPrecio(p.precio_anterior, tipo, direccion === 'aumentar' ? Number(valor) : -Number(valor), Number(redondeo) as 0 | 1 | 10 | 100 | 1000);
          const discrepancia = Math.abs(precioCalculadoCliente - p.precio_nuevo) >= 0.01;
          const warning = Math.abs(p.variacion_porcentual ?? 0) > 50 || (p.precio_anterior === 0 && p.precio_nuevo !== 0);
          return <tr className="border-t" key={`${p.tabla}-${p.registro_id}-${p.columna_precio}`}><td className="p-3">{showConcept ? LABELS[p.concepto] ?? p.etiqueta : ''}</td><td className="p-3">{p.etiqueta}</td><td className="p-3">{formatearPrecio(p.precio_anterior)} → <span title={discrepancia ? `Servidor: ${formatearPrecio(p.precio_nuevo)} · Cálculo local: ${formatearPrecio(precioCalculadoCliente)}` : 'Resultado oficial del servidor'} className={p.precio_nuevo <= 0 ? 'font-semibold text-red-600' : ''}>{formatearPrecio(p.precio_nuevo)}</span>{discrepancia && <span className="ml-1 text-red-600" title="Diferencia entre el cálculo local y el servidor">⚠</span>}</td><td className="p-3">{formatearPrecio(p.diferencia)}</td><td className="p-3">{p.variacion_porcentual === null ? '—' : `${p.variacion_porcentual.toFixed(2)}%`}{warning && <span className="ml-2 text-amber-600">⚠</span>}</td></tr>;
        });
        return [title, ...rows];
      })}</tbody></table></div>
      <div className="flex justify-between"><Button variant="outline" onClick={() => setPaso(2)}>Volver a editar</Button><Button variant="destructive" disabled={preview.bloqueantes > 0 || !preview.cantidad_precios} onClick={() => setConfirmOpen(true)}>Aplicar actualización</Button></div>
    </CardContent></Card>}

    <Card><CardHeader><CardTitle>Historial de actualizaciones</CardTitle></CardHeader><CardContent className="space-y-2">{historial.map((h) => <div key={h.id} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-3"><button className="text-left" onClick={() => void toggleDetalle(h)}><span className="font-medium">{fmtDate(h.created_at)} · {h.perfiles_usuario?.nombre_completo ?? 'Usuario'}</span><div className="text-sm text-muted-foreground">{h.tipo_ajuste === 'porcentaje' ? 'Porcentaje' : 'Monto fijo'} {h.valor > 0 ? '+' : ''}{h.valor} · {h.redondeo ? `Redondeo al múltiplo de ${h.redondeo}` : 'Sin redondeo'} · {h.conceptos.map((c) => LABELS[c] ?? c).join(', ')} · {h.cantidad_configuraciones} configuraciones / {h.cantidad_precios_modificados} precios</div>{h.nota && <div className="text-sm">{h.nota}</div>}</button><div className="flex items-center gap-2"><Badge variant={h.revertida_at ? 'outline' : 'secondary'}>{h.revertida_at ? 'Revertida' : 'Aplicada'}</Badge>{!h.revertida_at && <Button size="sm" variant="outline" disabled={saving} onClick={() => void deshacer(h)}>Deshacer</Button>}</div></div>{detalle?.id === h.id && <div className="mt-3 max-h-64 overflow-auto border-t pt-2 text-sm">{!detalle.actualizaciones_precio_detalle?.length && <p className="py-2 text-muted-foreground">Cargando o sin detalles.</p>}{(detalle.actualizaciones_precio_detalle ?? []).map((d, i) => <div key={i} className="flex flex-wrap justify-between gap-2 border-b py-1"><span>{LABELS[d.concepto] ?? d.concepto} · {d.tabla}.{d.columna_precio}</span><span>{formatearPrecio(d.precio_anterior)} → {formatearPrecio(d.precio_nuevo)}</span></div>)}</div>}</div>)}{!historial.length && <p className="text-sm text-muted-foreground">Todavía no hay actualizaciones.</p>}</CardContent></Card>

    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirmar actualización</AlertDialogTitle><AlertDialogDescription>Vas a modificar {preview?.cantidad_precios ?? 0} precios en {preview?.cantidad_configuraciones ?? 0} configuraciones. ¿Confirmar?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(e) => { e.preventDefault(); void aplicar(); }}>{saving ? 'Aplicando…' : 'Confirmar'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={conflictos.length > 0} onOpenChange={(open) => !open && setConflictos([])}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>No se puede deshacer sin sobrescribir cambios</AlertDialogTitle><AlertDialogDescription>Estos precios ya no coinciden con el valor aplicado. No se modificó ningún registro.</AlertDialogDescription></AlertDialogHeader><div className="max-h-60 overflow-auto text-xs">{conflictos.map((x, i) => <pre key={i} className="whitespace-pre-wrap border-b py-2">{JSON.stringify(x)}</pre>)}</div><AlertDialogFooter><AlertDialogCancel>Cerrar</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
