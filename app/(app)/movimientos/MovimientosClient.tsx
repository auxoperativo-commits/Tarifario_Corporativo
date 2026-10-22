'use client';

import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { HistoricoPreciosMatriz } from './HistoricoPreciosMatriz';

interface Movimiento {
  id: string; usuario_nombre: string; tipo: string; transporte_id: string | null;
  transporte_nombre: string | null; configuracion_id: string | null; origen_provincia: string | null;
  origen_localidad: string | null; destino_provincia: string | null; destino_localidad: string | null;
  detalle: string | null; created_at: string;
}
const LABELS: Record<string,string> = {
  configuracion_creada:'Alta de configuración',configuracion_duplicada:'Configuración duplicada',configuracion_editada:'Edición de configuración',
  configuracion_dada_de_baja:'Baja de configuración',configuracion_eliminada:'Configuración eliminada',transporte_creado:'Alta de transporte',
  transporte_editado:'Edición de transporte',transporte_dado_de_baja:'Baja de transporte',transporte_eliminado:'Transporte eliminado',precio_actualizado:'Precio actualizado',
};
function fecha(value:string){return new Intl.DateTimeFormat('es-AR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function ruta(item:Movimiento){return `${[item.origen_provincia,item.origen_localidad].filter(Boolean).join(' · ')||'Sin origen'} → ${[item.destino_provincia,item.destino_localidad].filter(Boolean).join(' · ')||'Sin destino'}`;}

export function MovimientosClient({ movimientosIniciales }: { movimientosIniciales:Movimiento[] }) {
  const [desde,setDesde]=useState(''); const [hasta,setHasta]=useState(''); const [transporteId,setTransporteId]=useState('');
  const [origen,setOrigen]=useState(''); const [destino,setDestino]=useState('');
  const [tab,setTab]=useState('movimientos');
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('tab')==='precios')setTab('precios');},[]);
  const movimientos=useMemo(()=>movimientosIniciales.filter((item)=>{
    const day=item.created_at.slice(0,10);
    return (!desde||day>=desde)&&(!hasta||day<=hasta)&&(!transporteId||(item.transporte_nombre??'').toLowerCase().includes(transporteId.toLowerCase()))
      &&(!origen||`${item.origen_provincia??''} ${item.origen_localidad??''}`.toLowerCase().includes(origen.toLowerCase()))
      &&(!destino||`${item.destino_provincia??''} ${item.destino_localidad??''}`.toLowerCase().includes(destino.toLowerCase()));
  }),[movimientosIniciales,desde,hasta,transporteId,origen,destino]);
  function limpiar(){setDesde('');setHasta('');setTransporteId('');setOrigen('');setDestino('');}
  return <Tabs value={tab} onValueChange={(value)=>{setTab(value);const p=new URLSearchParams(window.location.search);if(value==='precios')p.set('tab','precios');else p.delete('tab');window.history.replaceState(null,'',`${window.location.pathname}?${p.toString()}`);}} className="space-y-4">
    <TabsList><TabsTrigger value="movimientos">Movimientos</TabsTrigger><TabsTrigger value="precios">Histórico de precios</TabsTrigger></TabsList>
    <TabsContent value="movimientos" className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium text-muted-foreground">Desde<Input className="mt-1" type="date" value={desde} onChange={(e)=>setDesde(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Hasta<Input className="mt-1" type="date" value={hasta} onChange={(e)=>setHasta(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Transporte<Input className="mt-1" placeholder="Nombre del transporte" value={transporteId} onChange={(e)=>setTransporteId(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Origen<Input className="mt-1" placeholder="Provincia o localidad" value={origen} onChange={(e)=>setOrigen(e.target.value)} /></label>
        <label className="text-xs font-medium text-muted-foreground">Destino<Input className="mt-1" placeholder="Provincia o localidad" value={destino} onChange={(e)=>setDestino(e.target.value)} /></label>
        <div className="sm:col-span-2 lg:col-span-5"><Button type="button" variant="ghost" size="sm" onClick={limpiar}>Limpiar filtros</Button></div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white">{movimientos.length ? movimientos.map((item)=><div key={item.id} className="grid gap-1 border-b px-4 py-3 last:border-0 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center"><div><p className="text-sm font-medium text-slate-800">{LABELS[item.tipo]??item.tipo}</p><p className="text-xs text-muted-foreground">{item.transporte_nombre??'Sin transporte'}{item.configuracion_id?` · ${ruta(item)}`:''}</p></div><div className="text-xs text-muted-foreground">{item.usuario_nombre}{item.detalle?` · ${item.detalle}`:''}</div><time className="text-xs text-muted-foreground sm:text-right">{fecha(item.created_at)}</time></div>):<p className="p-6 text-sm text-muted-foreground">No hay movimientos para los filtros seleccionados.</p>}</div>
    </TabsContent>
    <TabsContent value="precios"><HistoricoPreciosMatriz /></TabsContent>
  </Tabs>;
}
