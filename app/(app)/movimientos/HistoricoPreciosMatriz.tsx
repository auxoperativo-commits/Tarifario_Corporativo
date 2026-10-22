'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TransportesPickerView, type TransportePickerItem } from '@/components/transportes/TransportesPickerView';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/lib/context/UserContext';
import { createClient } from '@/lib/supabase/client';
import { formatearPrecio } from '@/lib/calculos/envios';
import { cargarPreciosHistorico, cargarResumenHistorico, cargarRutasHistorico, type FiltrosHistorico } from '@/app/actions/historico-precios';
import { revertirPrecios } from '@/app/actions/actualizaciones-precio';

// Límite para que la matriz mantenga consultas y renderizado acotados.
export const MAX_TRANSPORTES_HISTORIAL = 10;
const PAGE_CACHE = new Map<string, unknown>();
const ROUTE_CACHE = new Map<string, unknown>();
const PRICE_CACHE = new Map<string, unknown>();
const TRANSPORT_CACHE_TTL_MS = 5 * 60 * 1000;
let transportesCache: { data: TransportePickerItem[]; updatedAt: number } | null = null;
const CONCEPTOS = [
  ['bultos', 'Bultos'], ['pallets', 'Pallets'], ['kg', 'Kg'], ['camion_completo', 'Camión completo'], ['servicios', 'Servicios de transporte'], ['tags', 'Tags con valor'],
];
const TIPOS = [['masiva', 'Masiva'], ['manual', 'Manual'], ['reversion', 'Reversión']];

type FechaCol = { fecha: string; tipo: string };
type Resumen = { fechas: FechaCol[]; fecha_base?: string; transportes: Array<{ transporte_id: string; nombre: string; variaciones: Record<string, number>; acumulado: number | null }>; indicadores: { mayor: { valor: number; transporte: string; detalle: string } | null; promedio: number | null; precios_seguidos: number; subas: number; actualizaciones: number; limite: boolean } };
type RutaResumen = { configuracion_id: string; transporte_id: string; origen: string; destino: string; activa: boolean | null; eliminada?: boolean; variaciones: Record<string, number>; acumulado: number | null };
type Celda = { fecha: string; base: boolean; tipo: string | null; precio: number | null; variacion: number | null; acumulado: number | null; nuevo: boolean };
type FilaPrecio = { configuracion_id: string; transporte_id: string; origen: string; destino: string; activa: boolean; registro_id: string | null; concepto: string; etiqueta: string; celdas: Celda[] };
type Transporte = TransportePickerItem;
type EventoPanel = { tipo_cambio: string; fecha_hora: string; transporte_nombre?: string; usuario_nombre?: string; actualizacion_id?: string | null; tipo_ajuste?: string | null; valor_ajuste?: number | null; conceptos_ajuste?: string[] | null; nota?: string | null; cantidad_configuraciones?: number | null; cantidad_precios_modificados?: number | null; precios_editados?: number | null; revertida_at?: string | null; revertida_por_nombre?: string | null; etiqueta?: string; precio_anterior?: number; precio_nuevo?: number };

const hoyLocal = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const haceMeses = (months: number) => {
  const date = new Date(); date.setMonth(date.getMonth() - months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const nfd = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');
const pct = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const dateLabel = (iso: string, includeYear: boolean) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', ...(includeYear ? { year: 'numeric' as const } : {}) }).format(new Date(`${iso}T12:00:00`)).replace('.', '');
const filterToken = (f: FiltrosHistorico) => JSON.stringify(f);

function EstadoCarga({ texto = 'Cargando...' }: { texto?: string }) {
  return <div role="status" className="flex min-h-16 items-center gap-2 px-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{texto}</div>;
}

export function HistoricoPreciosMatriz() {
  const { perfil } = useUser();
  const { toast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const [transportes, setTransportes] = useState<Transporte[]>(transportesCache?.data ?? []);
  const [transportesCargando, setTransportesCargando] = useState(!transportesCache);
  const [transportesError, setTransportesError] = useState<string | null>(null);
  const [retryTransportes, setRetryTransportes] = useState(0);
  const [retrySearch, setRetrySearch] = useState(0);
  const [selected, setSelected] = useState<Transporte[]>([]);
  const [query, setQuery] = useState('');
  const [remoteSuggestions, setRemoteSuggestions] = useState<Transporte[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [desde, setDesde] = useState(haceMeses(6));
  const [hasta, setHasta] = useState(hoyLocal());
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [conceptos, setConceptos] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [umbral, setUmbral] = useState('10');
  const [modoCelda, setModoCelda] = useState<'ambos' | 'precio' | 'variacion'>('ambos');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [resumenCargando, setResumenCargando] = useState(false);
  const [resumenError, setResumenError] = useState<string | null>(null);
  const [abiertosTransporte, setAbiertosTransporte] = useState<Set<string>>(new Set());
  const [abiertosRuta, setAbiertosRuta] = useState<Set<string>>(new Set());
  const [rutas, setRutas] = useState<Record<string, RutaResumen[]>>({});
  const [rutasCargando, setRutasCargando] = useState<Set<string>>(new Set());
  const [rutasError, setRutasError] = useState<Record<string, string>>({});
  const [precios, setPrecios] = useState<Record<string, FilaPrecio[]>>({});
  const [preciosCargando, setPreciosCargando] = useState<Set<string>>(new Set());
  const [preciosError, setPreciosError] = useState<Record<string, string>>({});
  const [fechaPanel, setFechaPanel] = useState<string | null>(null);
  const [eventosPanel, setEventosPanel] = useState<EventoPanel[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [revirtiendo, setRevirtiendo] = useState(false);
  const [conflictos, setConflictos] = useState<unknown[] | null>(null);
  const [urlReady, setUrlReady] = useState(false);

  // Hasta 1.000 activos se filtran sobre la lista liviana recibida una sola vez;
  // arriba de ese umbral se usa el buscador SQL remoto.
  const buscarEnServidor = transportes.length > 1000;
  const suggestions = useMemo(() => {
    if (buscarEnServidor) return remoteSuggestions;
    const q = nfd(query.trim());
    if (!q) return [];
    const chosen = new Set(selected.map((t) => t.id));
    return transportes.filter((t) => !chosen.has(t.id) && (nfd(t.razon_social).includes(q) || nfd(t.nombre_fantasia ?? '').includes(q)))
      .map((item) => ({ item, starts: nfd(item.razon_social).startsWith(q) || nfd(item.nombre_fantasia ?? '').startsWith(q) }))
      .sort((a, b) => Number(b.starts) - Number(a.starts) || (a.item.nombre_fantasia || a.item.razon_social).localeCompare(b.item.nombre_fantasia || b.item.razon_social, 'es-AR'))
      .slice(0, 10).map(({ item }) => item);
  }, [buscarEnServidor, query, remoteSuggestions, selected, transportes]);
  const filtros: FiltrosHistorico = useMemo(() => ({ transportes: selected.map((t) => t.id), desde, hasta, origen, destino, conceptos, tipos, umbral: Number(umbral) }), [selected, desde, hasta, origen, destino, conceptos, tipos, umbral]);
  const token = filterToken(filtros);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = (params.get('transportes') || '').split(',').filter(Boolean).slice(0, MAX_TRANSPORTES_HISTORIAL);
    if (ids.length) setSelected(ids.map((id) => transportes.find((t) => t.id === id) ?? { id, razon_social: 'Transporte', nombre_fantasia: null }));
    if (params.has('desde')) setDesde(params.get('desde')!);
    if (params.has('hasta')) setHasta(params.get('hasta')!);
    if (params.has('origen')) setOrigen(params.get('origen')!);
    if (params.has('destino')) setDestino(params.get('destino')!);
    if (params.has('conceptos')) setConceptos(params.get('conceptos')!.split(',').filter(Boolean));
    if (params.has('tipos')) setTipos(params.get('tipos')!.split(',').filter(Boolean));
    if (params.has('umbral')) setUmbral(params.get('umbral')!);
    setUrlReady(true);
  // URL state is read once; prop list arrives with the page response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cached=transportesCache && Date.now()-transportesCache.updatedAt<TRANSPORT_CACHE_TTL_MS;
    if(cached){setTransportes(transportesCache!.data);setTransportesCargando(false);return;}
    let cancelled=false;
    setTransportesCargando(true);setTransportesError(null);
    void supabase.from('transportes').select('id, razon_social, nombre_fantasia').eq('activo',true).order('razon_social').limit(1001)
      .then(({data,error})=>{
        if(cancelled)return;
        setTransportesCargando(false);
        if(error){setTransportesError(error.message);return;}
        const rows=(data??[]) as Transporte[];transportesCache={data:rows,updatedAt:Date.now()};setTransportes(rows);
        setSelected((old)=>old.map((picked)=>rows.find((row)=>row.id===picked.id)??picked));
      });
    return()=>{cancelled=true;};
  },[supabase,retryTransportes]);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    params.set('tab', 'precios');
    if (selected.length) params.set('transportes', selected.map((t) => t.id).join(','));
    params.set('desde', desde); params.set('hasta', hasta);
    if (origen) params.set('origen', origen); if (destino) params.set('destino', destino);
    if (conceptos.length) params.set('conceptos', conceptos.join(',')); if (tipos.length) params.set('tipos', tipos.join(','));
    params.set('umbral', umbral);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [urlReady, selected, desde, hasta, origen, destino, conceptos, tipos, umbral]);

  useEffect(() => {
    if (!buscarEnServidor || !query.trim()) { setRemoteSuggestions([]); setRemoteBusy(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    setRemoteBusy(true); setRemoteError(null);
    const timer = window.setTimeout(async () => {
      const {data,error} = await supabase.rpc('buscar_transportes_historial',{p_busqueda:query.trim()}).abortSignal(controller.signal);
      if (cancelled || controller.signal.aborted) return;
      setRemoteBusy(false);
      if (error) setRemoteError(error.message);
      else setRemoteSuggestions(((data??[]) as Transporte[]).filter((t) => !selected.some((s) => s.id === t.id)).slice(0, 10));
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [buscarEnServidor, query, selected, supabase, retrySearch]);

  const loadSummary = useCallback(async () => {
    if (!filtros.transportes.length) { setResumen(null); setResumenError(null); return; }
    const cached = PAGE_CACHE.get(token) as Resumen | undefined;
    if (cached) { setResumen(cached); setResumenError(null); return; }
    setResumenCargando(true); setResumenError(null);
    const started = performance.now();
    const result = await cargarResumenHistorico(filtros);
    console.info(`[historico-precios] capa 1 cliente ${(performance.now() - started).toFixed(0)} ms · ${((new TextEncoder().encode(JSON.stringify(result.data ?? null)).byteLength)/1024).toFixed(1)} KB`);
    setResumenCargando(false);
    if (result.error) { setResumenError(result.error); setResumen(null); return; }
    const data = result.data as Resumen;
    PAGE_CACHE.set(token, data); setResumen(data);
  }, [filtros, token]);

  useEffect(() => { setResumen(null); setAbiertosTransporte(new Set()); setAbiertosRuta(new Set()); setRutas({}); setPrecios({}); void loadSummary(); }, [loadSummary]);

  async function loadRoutes(id: string, force = false) {
    const key = `${token}:${id}`;
    if (!force && ROUTE_CACHE.has(key)) { setRutas((old) => ({ ...old, [id]: ROUTE_CACHE.get(key) as RutaResumen[] })); return; }
    setRutasCargando((old) => new Set(old).add(id)); setRutasError((old) => ({ ...old, [id]: '' }));
    const started=performance.now();
    const result = await cargarRutasHistorico(filtros, id);
    console.info(`[historico-precios] capa 2 cliente ${(performance.now()-started).toFixed(0)} ms · ${((new TextEncoder().encode(JSON.stringify(result.data??null)).byteLength)/1024).toFixed(1)} KB`);
    setRutasCargando((old) => { const next = new Set(old); next.delete(id); return next; });
    if (result.error) { setRutasError((old) => ({ ...old, [id]: result.error! })); return; }
    const data = result.data as RutaResumen[]; ROUTE_CACHE.set(key, data); setRutas((old) => ({ ...old, [id]: data }));
  }

  async function loadPrices(transportId: string, configId: string, force = false) {
    const key = `${token}:${configId}`;
    if (!force && PRICE_CACHE.has(key)) { setPrecios((old) => ({ ...old, [configId]: PRICE_CACHE.get(key) as FilaPrecio[] })); return; }
    setPreciosCargando((old) => new Set(old).add(configId)); setPreciosError((old) => ({ ...old, [configId]: '' }));
    const started=performance.now();
    const result = await cargarPreciosHistorico(filtros, transportId, configId);
    console.info(`[historico-precios] capa 3 cliente ${(performance.now()-started).toFixed(0)} ms · ${((new TextEncoder().encode(JSON.stringify(result.data??null)).byteLength)/1024).toFixed(1)} KB`);
    setPreciosCargando((old) => { const next = new Set(old); next.delete(configId); return next; });
    if (result.error) { setPreciosError((old) => ({ ...old, [configId]: result.error! })); return; }
    const data = result.data as FilaPrecio[]; PRICE_CACHE.set(key, data); setPrecios((old) => ({ ...old, [configId]: data }));
  }

  function toggleTransport(id: string) {
    setAbiertosTransporte((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id); else { next.add(id); void loadRoutes(id); }
      return next;
    });
  }
  function toggleRoute(transportId: string, id: string) {
    setAbiertosRuta((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id); else { next.add(id); void loadPrices(transportId, id); }
      return next;
    });
  }
  function addTransport(t: Transporte) {
    if (selected.some((x) => x.id === t.id) || selected.length >= MAX_TRANSPORTES_HISTORIAL) return;
    setSelected((old) => [...old, t]); setQuery(''); setRemoteSuggestions([]);
  }
  function removeTransport(id: string) { setSelected((old) => old.filter((t) => t.id !== id)); }
  function updateRange(months: number) { setDesde(haceMeses(months)); setHasta(hoyLocal()); }
  const tieneAnio = desde.slice(0,4) !== hasta.slice(0,4);
  const columnas = useMemo(() => resumen ? [{ fecha: resumen.fecha_base ?? desde, tipo: 'Base' }, ...resumen.fechas.slice().sort((a, b) => a.fecha.localeCompare(b.fecha))] : [], [resumen, desde]);
  const columnClass = 'w-[96px] min-w-[96px]';
  const toggleValue = (list: string[], value: string, set: (value: string[]) => void) => set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  async function openDatePanel(date: string) {
    setFechaPanel(date); setPanelLoading(true); setEventosPanel([]);
    // El panel consulta sus eventos solo al abrirlo.
    const { data, error } = await createClient().rpc('historial_precios_matriz_eventos_fecha', {
      p_transportes: filtros.transportes, p_fecha: date, p_desde: desde, p_hasta: hasta,
      p_origen: origen || null, p_destino: destino || null, p_conceptos: conceptos, p_tipos: tipos,
    });
    setPanelLoading(false);
    if (error) { toast({ variant: 'destructive', title: 'No se pudieron cargar los eventos.', description: error.message }); return; }
    setEventosPanel((data ?? []) as EventoPanel[]);
  }
  async function undo(id: string) {
    if (!window.confirm('¿Deshacer esta actualización masiva?')) return;
    setRevirtiendo(true); const result = await revertirPrecios(id); setRevirtiendo(false);
    if (result.error) { toast({ variant: 'destructive', title: 'No se pudo deshacer.', description: result.error }); return; }
    const data = result.data as { ok: boolean; conflictos?: unknown[] };
    if (!data.ok) { setConflictos(data.conflictos ?? []); return; }
    setFechaPanel(null); PAGE_CACHE.clear(); ROUTE_CACHE.clear(); PRICE_CACHE.clear();
    toast({ title: 'Actualización revertida.' }); await loadSummary();
  }

  return <div className="space-y-4">
    <section className="space-y-3 rounded-lg border bg-white p-4">
      <div className="space-y-2"><label htmlFor="transportes-matriz" className="text-sm font-medium">Transportes <span className="text-muted-foreground">(hasta {MAX_TRANSPORTES_HISTORIAL})</span></label>
        <TransportesPickerView id="transportes-matriz" query={query} onQuery={setQuery} suggestions={suggestions} selected={selected}
          loading={transportesCargando} searching={remoteBusy} error={transportesError ?? remoteError} onSelect={addTransport} onRemove={removeTransport} onRetry={() => { setTransportesError(null); setRemoteError(null); setRetryTransportes((n)=>n+1); setRetrySearch((n)=>n+1); }} />
        {selected.length >= MAX_TRANSPORTES_HISTORIAL && <p className="text-xs text-muted-foreground">Ya elegiste el máximo de {MAX_TRANSPORTES_HISTORIAL} transportes.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-muted-foreground">Desde<Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Hasta<Input type="date" value={hasta} min={desde} max={hoyLocal()} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Origen<Input placeholder="Sucursal o grupo" value={origen} onChange={(e) => setOrigen(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Destino<Input placeholder="Provincia, localidad o ubicación" value={destino} onChange={(e) => setDestino(e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2">{[3, 6, 12].map((m) => <Button key={m} size="sm" variant="outline" onClick={() => updateRange(m)}>{m} meses</Button>)}</div>
      <div className="grid gap-3 lg:grid-cols-4">
        <fieldset className="text-xs"><legend className="mb-1 font-medium">Concepto</legend><div className="flex flex-wrap gap-x-3 gap-y-1">{CONCEPTOS.map(([id, label]) => <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={conceptos.includes(id)} onChange={() => toggleValue(conceptos,id,setConceptos)} />{label}</label>)}</div></fieldset>
        <fieldset className="text-xs"><legend className="mb-1 font-medium">Tipo de cambio</legend><div className="flex flex-wrap gap-x-3 gap-y-1">{TIPOS.map(([id, label]) => <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={tipos.includes(id)} onChange={() => toggleValue(tipos,id,setTipos)} />{label}</label>)}</div></fieldset>
        <label className="text-xs font-medium">Resaltar subas de<Select value={umbral} onValueChange={setUmbral}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['5','10','15'].map((x) => <SelectItem key={x} value={x}>{x}% o más</SelectItem>)}</SelectContent></Select></label>
        <label className="text-xs font-medium">Mostrar en cada celda<Select value={modoCelda} onValueChange={(v) => setModoCelda(v as typeof modoCelda)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ambos">Precio y variación</SelectItem><SelectItem value="precio">Solo precio</SelectItem><SelectItem value="variacion">Solo variación</SelectItem></SelectContent></Select></label>
      </div>
      <p className="text-xs text-muted-foreground">Los filtros de fecha, origen, destino, concepto y tipo se aplican en el servidor.</p>
    </section>

    {!selected.length ? <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">Elegí uno o más transportes para ver su historial de precios</p>
      : resumenCargando ? <div className="rounded-lg border bg-white"><EstadoCarga texto="Cargando resumen..." /></div>
      : resumenError ? <div role="alert" className="rounded-lg border border-destructive/40 bg-white p-5 text-sm text-destructive">{resumenError}<Button className="ml-3" size="sm" variant="outline" onClick={() => void loadSummary()}>Reintentar</Button></div>
      : resumen && <>
        {resumen.indicadores.limite && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Mostrando las últimas 24 fechas con cambios. Acortá el rango para ver más.</p>}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-white p-4"><p className="text-xs text-muted-foreground">Mayor suba acumulada</p><p className="mt-1 text-xl font-semibold">{pct(resumen.indicadores.mayor?.valor)}</p><p className="text-xs text-muted-foreground">{resumen.indicadores.mayor ? `${resumen.indicadores.mayor.transporte} · ${resumen.indicadores.mayor.detalle}` : 'Sin precios seguidos'}</p></div>
          <div className="rounded-lg border bg-white p-4"><p className="text-xs text-muted-foreground">Suba promedio total</p><p className="mt-1 text-xl font-semibold">{pct(resumen.indicadores.promedio)}</p><p className="text-xs text-muted-foreground">de {resumen.indicadores.precios_seguidos} precios seguidos</p></div>
          <div className="rounded-lg border bg-white p-4"><p className="text-xs text-muted-foreground">Subas de {umbral}% o más</p><p className={`mt-1 text-xl font-semibold ${resumen.indicadores.subas ? 'text-red-600' : ''}`}>{resumen.indicadores.subas}</p><p className="text-xs text-muted-foreground">en {resumen.indicadores.actualizaciones} actualizaciones</p></div>
        </div>
        {!resumen.fechas.length ? <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">No hay cambios de precio en este rango para los transportes elegidos. Probá ampliar las fechas.</p> :
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <thead><tr className="sticky top-0 z-20 bg-slate-50">
                <th className="sticky left-0 z-30 min-w-[220px] border-b bg-slate-50 p-3 text-left">Transporte / ruta / precio</th>
                {columnas.map((col, i) => <th key={`${col.fecha}-${i}`} className={`${columnClass} border-b p-2 text-right`}><button type="button" disabled={i===0} onClick={() => void openDatePanel(col.fecha)} className="font-medium disabled:cursor-default">{i===0 ? dateLabel(desde,tieneAnio) : dateLabel(col.fecha,tieneAnio)}</button><span className="block text-[10px] font-normal text-muted-foreground">{col.tipo}</span></th>)}
                <th className="sticky right-0 z-30 min-w-[110px] border-b bg-slate-50 p-2 text-right">Acumulado<span className="block text-[10px] font-normal text-muted-foreground">desde {dateLabel(resumen.fecha_base ?? desde,tieneAnio)}</span></th>
              </tr></thead>
              <tbody>{resumen.transportes.map((tr) => {
                const open = abiertosTransporte.has(tr.transporte_id); const routeRows = rutas[tr.transporte_id] ?? [];
                return <FragmentTransporte key={tr.transporte_id} tr={tr} open={open} toggle={() => toggleTransport(tr.transporte_id)} columns={columnas} routes={routeRows} routesLoading={rutasCargando.has(tr.transporte_id)} routesError={rutasError[tr.transporte_id]} retryRoutes={() => void loadRoutes(tr.transporte_id,true)} openedRoutes={abiertosRuta} toggleRoute={toggleRoute} prices={precios} pricesLoading={preciosCargando} pricesError={preciosError} retryPrices={loadPrices} threshold={Number(umbral)} mode={modoCelda} formatDate={(d) => dateLabel(d,tieneAnio)} openDate={openDatePanel} />;
              })}</tbody>
            </table>
          </div>}
        <p className="text-xs text-muted-foreground">Rojo: el transporte subió (nos cuesta más). Verde: bajó. Fondo rojo: suba igual o mayor al umbral elegido. La variación de cada columna se calcula contra la columna anterior.</p>
      </>}

    {fechaPanel && <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onClick={() => setFechaPanel(null)}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-label="Eventos del día" onClick={(e) => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Eventos · {dateLabel(fechaPanel,tieneAnio)}</h2><button onClick={() => setFechaPanel(null)} aria-label="Cerrar"><X className="h-5 w-5" /></button></div>{panelLoading ? <EstadoCarga /> : eventosPanel.length ? <div className="space-y-3">{eventosPanel.map((event,index) => <article key={`${event.actualizacion_id ?? event.fecha_hora}-${index}`} className="rounded-md border p-3"><div className="flex justify-between gap-2"><Badge variant="outline">{event.tipo_cambio}</Badge><span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short'}).format(new Date(event.fecha_hora))}</span></div><p className="mt-2 text-sm font-medium">{event.transporte_nombre} · {event.etiqueta}</p><p className="text-xs text-muted-foreground">{event.usuario_nombre ?? 'Usuario'}{event.tipo_cambio==='manual'?` · ${event.precios_editados ?? 0} precios editados`:event.precio_anterior==null?'':` · ${formatearPrecio(event.precio_anterior)} → ${formatearPrecio(event.precio_nuevo ?? 0)}`}</p>{event.actualizacion_id && <div className="mt-2 text-sm">{event.tipo_ajuste === 'porcentaje' ? `${event.valor_ajuste}%` : `${formatearPrecio(event.valor_ajuste ?? 0)} fijo`} · {(event.conceptos_ajuste ?? []).join(', ')}<p className="text-xs text-muted-foreground">{event.nota} · {event.cantidad_configuraciones} configuraciones · {event.cantidad_precios_modificados} precios {event.revertida_at ? `· Revertida ${new Date(event.revertida_at).toLocaleString('es-AR')}` : ''}</p>{perfil.rol === 'admin' && event.tipo_cambio === 'masiva' && !event.revertida_at && <Button size="sm" className="mt-2" variant="destructive" disabled={revirtiendo} onClick={() => void undo(event.actualizacion_id!)}>{revirtiendo ? 'Deshaciendo...' : 'Deshacer'}</Button>}</div>}</article>)}</div> : <p className="text-sm text-muted-foreground">No hay eventos en esta fecha para los filtros.</p>}</aside></div>}
    {conflictos && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"><div className="max-w-lg rounded-lg bg-white p-5"><h3 className="font-semibold">No se puede deshacer</h3><p className="my-2 text-sm text-muted-foreground">Hay precios modificados después de esta actualización. No se revirtió ningún precio.</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(conflictos,null,2)}</pre><Button className="mt-3" onClick={() => setConflictos(null)}>Cerrar</Button></div></div>}
  </div>;
}

function FragmentTransporte({ tr, open, toggle, columns, routes, routesLoading, routesError, retryRoutes, openedRoutes, toggleRoute, prices, pricesLoading, pricesError, retryPrices, threshold, mode, formatDate, openDate }: {
  tr: Resumen['transportes'][number]; open: boolean; toggle: () => void; columns: FechaCol[];
  routes: RutaResumen[]; routesLoading: boolean; routesError?: string; retryRoutes: () => void;
  openedRoutes: Set<string>; toggleRoute: (transportId: string, configId: string) => void;
  prices: Record<string, FilaPrecio[]>; pricesLoading: Set<string>; pricesError: Record<string,string>;
  retryPrices: (transportId: string, configId: string, force?: boolean) => void; threshold: number;
  mode: 'ambos'|'precio'|'variacion'; formatDate: (date:string)=>string; openDate: (date:string)=>void;
}) {
  const accColor = (v: number | null) => v == null || v === 0 ? 'text-slate-400' : v > 0 ? 'text-red-600' : 'text-emerald-700';
  const summaryCells = (values: Record<string,number>, level: 'prom'|'price') => <>{columns.map((col, i) => <td key={`${col.fecha}-${i}`} className="p-2 text-right tabular-nums">{i===0 ? '—' : values[col.fecha] == null ? '—' : <span className={accColor(values[col.fecha])}>{pct(values[col.fecha])}{level==='prom' && <small className="ml-1 text-[9px] text-muted-foreground">prom.</small>}</span>}</td>)}</>;
  return <>
    <tr className="bg-slate-100"><th scope="row" className="sticky left-0 z-10 min-w-[220px] bg-slate-100 p-2 text-left"><button className="flex items-center gap-2 font-semibold" onClick={toggle}>{open?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}{tr.nombre}</button></th>{summaryCells(tr.variaciones,'prom')}<td className={`sticky right-0 bg-slate-100 p-2 text-right font-semibold ${accColor(tr.acumulado)}`}>{pct(tr.acumulado)}</td></tr>
    {open && routesLoading && <tr><td colSpan={columns.length+2}><EstadoCarga texto="Cargando rutas..."/></td></tr>}
    {open && routesError && <tr><td colSpan={columns.length+2} className="p-3 text-sm text-destructive">{routesError}<Button className="ml-2" size="sm" variant="outline" onClick={retryRoutes}>Reintentar</Button></td></tr>}
    {open && routes.map((route) => {
      const rOpen=openedRoutes.has(route.configuracion_id); const priceRows=prices[route.configuracion_id]??[];
      return <FragmentRuta key={route.configuracion_id} route={route} open={rOpen} toggle={()=>toggleRoute(tr.transporte_id,route.configuracion_id)} columns={columns} loading={pricesLoading.has(route.configuracion_id)} error={pricesError[route.configuracion_id]} retry={()=>retryPrices(tr.transporte_id,route.configuracion_id,true)} rows={priceRows} threshold={threshold} mode={mode} formatDate={formatDate} openDate={openDate} summaryCells={summaryCells}/>;
    })}
  </>;
}

function FragmentRuta({ route, open, toggle, columns, loading, error, retry, rows, threshold, mode, formatDate, openDate, summaryCells }: {
  route: RutaResumen; open:boolean; toggle:()=>void; columns:FechaCol[]; loading:boolean; error?:string; retry:()=>void; rows:FilaPrecio[]; threshold:number; mode:'ambos'|'precio'|'variacion'; formatDate:(d:string)=>string; openDate:(d:string)=>void; summaryCells:(values:Record<string,number>,level:'prom'|'price')=>JSX.Element;
}) {
  return <>
    <tr className="border-t"><th scope="row" className="sticky left-0 z-10 min-w-[220px] bg-white p-2 pl-7 text-left"><button className="flex items-center gap-2 font-medium" onClick={toggle}>{open?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}{route.origen.startsWith('Grupo ')?<><span>{route.origen.slice(6)}</span><Badge variant="outline">Grupo</Badge></>:route.origen} → {route.destino}{route.eliminada?<Badge variant="outline" className="ml-1">Configuración eliminada</Badge>:route.activa===false?<Badge variant="outline" className="ml-1">Inactiva</Badge>:null}</button></th>{summaryCells(route.variaciones,'prom')}<td className="sticky right-0 bg-white p-2 text-right">{pct(route.acumulado)}</td></tr>
    {open && loading && <tr><td colSpan={columns.length+2}><EstadoCarga texto="Cargando precios..."/></td></tr>}
    {open && error && <tr><td colSpan={columns.length+2} className="p-3 text-sm text-destructive">{error}<Button className="ml-2" size="sm" variant="outline" onClick={retry}>Reintentar</Button></td></tr>}
    {open && rows.map((row,index) => <tr key={`${row.registro_id??row.etiqueta}-${index}`} className="border-t text-xs">
      <th scope="row" className="sticky left-0 z-10 min-w-[220px] bg-white p-2 pl-12 text-left font-normal"><span className="block text-[10px] text-muted-foreground">{row.concepto}</span>{row.etiqueta}</th>
      {columns.map((col,i) => {
        const cell = row.celdas.find((x)=>x.base ? i===0 : x.fecha===col.fecha);
        const pctRounded = cell?.variacion == null ? null : Number(cell.variacion.toFixed(1));
        const highlight = pctRounded != null && pctRounded >= threshold;
        const color = cell?.variacion == null || cell.variacion===0 ? 'text-slate-400' : cell.variacion>0 ? 'text-red-600' : 'text-emerald-700';
        return <td key={`${col.fecha}-${i}`} className={`p-2 text-right tabular-nums ${highlight?'bg-red-50':''}`}>
          {i===0 ? (modoCell(mode)==='variacion' ? <span className="text-muted-foreground">base</span> : cell?.precio==null?'—':formatearPrecio(cell.precio)) : !cell || cell.precio==null ? '—' : mode==='precio' ? formatearPrecio(cell.precio) : mode==='variacion' ? <span className={color}>{cell.variacion==null?'sin cambio':`${cell.variacion>0?'↑':'↓'} ${pct(cell.variacion)}`}</span> : <><span className={cell.variacion!=null?'font-medium':''}>{formatearPrecio(cell.precio)}</span><span className={`mt-0.5 block ${color}`}>{cell.variacion==null?'sin cambio':`${cell.variacion>0?'↑':'↓'} ${pct(cell.variacion)}`}</span></>}
          {cell?.nuevo&&<small className="ml-1 text-[9px] text-muted-foreground">nuevo</small>}
        </td>;
      })}
      <td className="sticky right-0 bg-white p-2 text-right"><span className={row.celdas.at(-1)?.acumulado==null?'text-slate-400':row.celdas.at(-1)!.acumulado!>0?'text-red-600':'text-emerald-700'}>{pct(row.celdas.at(-1)?.acumulado)}</span>{row.celdas.at(-1)?.acumulado ? <span className="mt-1 block h-1 rounded bg-slate-200"><span className="block h-1 rounded bg-current" style={{width:`${Math.min(100,Math.abs(row.celdas.at(-1)!.acumulado!)/25*100)}%`}}/></span>:null}</td>
    </tr>)}
  </>;
}

function modoCell(mode:'ambos'|'precio'|'variacion') { return mode; }
