'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatearPrecio } from '@/lib/calculos/envios';

interface Movimiento {
  id: string;
  usuario_nombre: string;
  tipo: string;
  transporte_id: string | null;
  transporte_nombre: string | null;
  configuracion_id: string | null;
  origen_provincia: string | null;
  origen_localidad: string | null;
  destino_provincia: string | null;
  destino_localidad: string | null;
  detalle: string | null;
  created_at: string;
}

interface HistorialPrecio extends Omit<Movimiento, 'tipo' | 'detalle'> {
  modalidad: string;
  desde: number | null;
  valor_anterior: number | null;
  valor_nuevo: number | null;
}

interface TransporteFiltro { id: string; razon_social: string; nombre_fantasia: string | null }

function fecha(fechaIso: string) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(fechaIso));
}

function ruta(item: Pick<Movimiento, 'origen_provincia' | 'origen_localidad' | 'destino_provincia' | 'destino_localidad'>) {
  const origen = [item.origen_provincia, item.origen_localidad].filter(Boolean).join(' - ') || 'Sin origen';
  const destino = [item.destino_provincia, item.destino_localidad].filter(Boolean).join(' - ') || 'Sin destino';
  return `${origen} -> ${destino}`;
}

const LABELS: Record<string, string> = {
  configuracion_creada: 'Alta de configuración',
  configuracion_duplicada: 'Configuración duplicada',
  configuracion_editada: 'Edición de configuración',
  configuracion_dada_de_baja: 'Baja de configuración',
  configuracion_eliminada: 'Configuración eliminada',
  transporte_creado: 'Alta de transporte',
  transporte_editado: 'Edición de transporte',
  transporte_dado_de_baja: 'Baja de transporte',
  transporte_eliminado: 'Transporte eliminado',
  precio_actualizado: 'Precio actualizado',
};

export function MovimientosClient({ movimientosIniciales, historialPreciosInicial, transportes }: {
  movimientosIniciales: Movimiento[];
  historialPreciosInicial: HistorialPrecio[];
  transportes: TransporteFiltro[];
}) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [transporteId, setTransporteId] = useState('');
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const coincide = (item: Pick<Movimiento, 'created_at' | 'transporte_id' | 'origen_provincia' | 'origen_localidad' | 'destino_provincia' | 'destino_localidad'>) => {
    const dia = item.created_at.slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (transporteId && item.transporte_id !== transporteId) return false;
    if (origen && !`${item.origen_provincia ?? ''} ${item.origen_localidad ?? ''}`.toLowerCase().includes(origen.toLowerCase())) return false;
    if (destino && !`${item.destino_provincia ?? ''} ${item.destino_localidad ?? ''}`.toLowerCase().includes(destino.toLowerCase())) return false;
    return true;
  };

  const movimientos = useMemo(() => movimientosIniciales.filter(coincide), [movimientosIniciales, desde, hasta, transporteId, origen, destino]);
  const precios = useMemo(() => historialPreciosInicial.filter(coincide), [historialPreciosInicial, desde, hasta, transporteId, origen, destino]);
  const grupos = useMemo(() => {
    const resultado = new Map<string, HistorialPrecio[]>();
    precios.forEach((item) => {
      const clave = `${item.configuracion_id}-${item.modalidad}-${item.desde ?? 'general'}`;
      resultado.set(clave, [...(resultado.get(clave) ?? []), item]);
    });
    return Array.from(resultado.entries());
  }, [precios]);

  function limpiar() { setDesde(''); setHasta(''); setTransporteId(''); setOrigen(''); setDestino(''); }

  return (
    <Tabs defaultValue="movimientos" className="space-y-4">
      <TabsList>
        <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
        <TabsTrigger value="precios">Históricos de precios</TabsTrigger>
      </TabsList>

      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium text-muted-foreground">Desde<Input className="mt-1" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Hasta<Input className="mt-1" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Transporte<select className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm text-foreground" value={transporteId} onChange={(e) => setTransporteId(e.target.value)}><option value="">Todos</option>{transportes.map((t) => <option key={t.id} value={t.id}>{t.nombre_fantasia || t.razon_social}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Origen<Input className="mt-1" placeholder="Provincia o localidad" value={origen} onChange={(e) => setOrigen(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Destino<Input className="mt-1" placeholder="Provincia o localidad" value={destino} onChange={(e) => setDestino(e.target.value)} /></label>
        <div className="sm:col-span-2 lg:col-span-5"><Button type="button" variant="ghost" size="sm" onClick={limpiar}>Limpiar filtros</Button></div>
      </div>

      <TabsContent value="movimientos">
        <div className="overflow-hidden rounded-lg border bg-white">
          {movimientos.length ? movimientos.map((item) => (
            <div key={item.id} className="grid gap-1 border-b px-4 py-3 last:border-0 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center">
              <div><p className="text-sm font-medium text-slate-800">{LABELS[item.tipo] ?? item.tipo}</p><p className="text-xs text-muted-foreground">{item.transporte_nombre ?? 'Sin transporte'}{item.configuracion_id ? ` · ${ruta(item)}` : ''}</p></div>
              <div className="text-xs text-muted-foreground">{item.usuario_nombre}{item.detalle ? ` · ${item.detalle}` : ''}</div>
              <time className="text-xs text-muted-foreground sm:text-right">{fecha(item.created_at)}</time>
            </div>
          )) : <p className="p-6 text-sm text-muted-foreground">No hay movimientos para los filtros seleccionados.</p>}
        </div>
      </TabsContent>

      <TabsContent value="precios">
        <div className="space-y-3">
          {grupos.length ? grupos.map(([clave, ajustes]) => {
            const ultimo = ajustes[0];
            const abierto = expandidos.has(clave);
            return <div key={clave} className="overflow-hidden rounded-lg border bg-white">
              <button type="button" onClick={() => setExpandidos((prev) => { const nuevo = new Set(prev); nuevo.has(clave) ? nuevo.delete(clave) : nuevo.add(clave); return nuevo; })} className="grid w-full gap-2 p-4 text-left sm:grid-cols-[1.2fr_1fr_auto_auto] sm:items-center">
                <div><p className="text-sm font-medium text-slate-800">{ultimo.transporte_nombre ?? 'Sin transporte'}</p><p className="text-xs text-muted-foreground">{ruta(ultimo)}</p></div>
                <Badge variant="outline" className="w-fit">{ultimo.modalidad}{ultimo.desde !== null ? ` desde ${ultimo.desde}` : ''}</Badge>
                <div className="text-sm"><span className="text-muted-foreground">{ultimo.valor_anterior === null ? 'Sin valor' : formatearPrecio(ultimo.valor_anterior)}</span><span className="mx-2 text-muted-foreground">{'->'}</span><strong>{ultimo.valor_nuevo === null ? 'Sin valor' : formatearPrecio(ultimo.valor_nuevo)}</strong></div>
                <span className="justify-self-end text-muted-foreground">{abierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
              </button>
              {abierto && <div className="border-t bg-slate-50 px-4 py-2">{ajustes.map((ajuste) => <div key={ajuste.id} className="grid gap-1 border-b py-2 text-xs last:border-0 sm:grid-cols-[1fr_auto_auto]"><span>{fecha(ajuste.created_at)} · {ajuste.usuario_nombre}</span><span>{ajuste.valor_anterior === null ? 'Sin valor' : formatearPrecio(ajuste.valor_anterior)} {'->'} {ajuste.valor_nuevo === null ? 'Sin valor' : formatearPrecio(ajuste.valor_nuevo)}</span><span className="text-muted-foreground">{ajuste.modalidad}</span></div>)}</div>}
            </div>;
          }) : <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">No hay cambios de precios para los filtros seleccionados.</p>}
        </div>
      </TabsContent>
    </Tabs>
  );
}
