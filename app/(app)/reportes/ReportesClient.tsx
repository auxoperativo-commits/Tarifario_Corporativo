'use client';

import { useMemo, useState } from 'react';
import { BarChart3, PieChart, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatearPrecio } from '@/lib/calculos/envios';

interface ReporteConfiguracion {
  id: string;
  origen_provincia: string;
  origen_localidad: string | null;
  destino_provincia: string;
  destino_localidad: string | null;
  precio_camion_completo: number | null;
  transportes: { id: string; razon_social: string; nombre_fantasia: string | null } | null;
  tarifas_bulto: { desde_bulto: number; precio: number }[];
  tarifas_pallet: { desde_pallet: number; precio: number }[];
}

interface Barra { nombre: string; valor: number; }

function nombreTransporte(t: ReporteConfiguracion['transportes']) {
  return t?.nombre_fantasia || t?.razon_social || 'Sin transporte';
}

function promedio(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function construirBarras(configs: ReporteConfiguracion[], tipo: 'bultos' | 'pallets' | 'camion'): Barra[] {
  const agrupados = new Map<string, number[]>();
  configs.forEach((config) => {
    const valor = tipo === 'bultos'
      ? config.tarifas_bulto.find((tarifa) => tarifa.desde_bulto === 1)?.precio
      : tipo === 'pallets'
        ? config.tarifas_pallet.find((tarifa) => tarifa.desde_pallet === 1)?.precio
        : config.precio_camion_completo ?? undefined;
    if (valor === undefined || valor === null) return;
    const nombre = nombreTransporte(config.transportes);
    agrupados.set(nombre, [...(agrupados.get(nombre) ?? []), Number(valor)]);
  });
  return Array.from(agrupados.entries()).map(([nombre, valores]) => ({ nombre, valor: promedio(valores) ?? 0 })).sort((a, b) => b.valor - a.valor);
}

function Barras({ datos }: { datos: Barra[] }) {
  const maximo = Math.max(...datos.map((dato) => dato.valor), 1);
  if (!datos.length) return <p className="text-sm text-muted-foreground">No hay tarifas cargadas para estos filtros.</p>;
  return <div className="space-y-3">{datos.map((dato) => <div key={dato.nombre} className="grid grid-cols-[minmax(110px,1fr)_minmax(120px,3fr)_auto] items-center gap-3 text-sm"><span className="truncate" title={dato.nombre}>{dato.nombre}</span><div className="h-7 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-primary transition-all" style={{ width: `${Math.max(4, dato.valor / maximo * 100)}%` }} /></div><span className="tabular-nums font-medium">{formatearPrecio(dato.valor)}</span></div>)}</div>;
}

function Resumen({ datos, etiqueta }: { datos: Barra[]; etiqueta: string }) {
  const valores = datos.map((dato) => dato.valor);
  const media = promedio(valores);
  const barata = datos.length ? datos[datos.length - 1] : null;
  const cara = datos.length ? datos[0] : null;
  return <div className="grid gap-3 sm:grid-cols-3 mb-4"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Promedio {etiqueta}</p><p className="mt-1 text-xl font-bold">{media === null ? '—' : formatearPrecio(media)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Más económica</p><p className="mt-1 font-semibold truncate">{barata?.nombre ?? '—'}</p><p className="text-sm text-muted-foreground">{barata ? formatearPrecio(barata.valor) : ''}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Más cara</p><p className="mt-1 font-semibold truncate">{cara?.nombre ?? '—'}</p><p className="text-sm text-muted-foreground">{cara ? formatearPrecio(cara.valor) : ''}</p></CardContent></Card></div>;
}

export function ReportesClient({ configuraciones }: { configuraciones: ReporteConfiguracion[] }) {
  const [origenProvincia, setOrigenProvincia] = useState('');
  const [origenLocalidad, setOrigenLocalidad] = useState('');
  const [destinoProvincia, setDestinoProvincia] = useState('');
  const [destinoLocalidad, setDestinoLocalidad] = useState('');

  const opciones = (campo: keyof ReporteConfiguracion) => Array.from(new Set(configuraciones.map((config) => config[campo]).filter(Boolean) as string[])).sort();
  const configsFiltradas = useMemo(() => configuraciones.filter((config) =>
    (!origenProvincia || config.origen_provincia === origenProvincia) &&
    (!origenLocalidad || config.origen_localidad === origenLocalidad) &&
    (!destinoProvincia || config.destino_provincia === destinoProvincia) &&
    (!destinoLocalidad || config.destino_localidad === destinoLocalidad)
  ), [configuraciones, origenProvincia, origenLocalidad, destinoProvincia, destinoLocalidad]);
  const barrasBultos = useMemo(() => construirBarras(configsFiltradas, 'bultos'), [configsFiltradas]);
  const barrasPallets = useMemo(() => construirBarras(configsFiltradas, 'pallets'), [configsFiltradas]);
  const barrasCamion = useMemo(() => construirBarras(configsFiltradas, 'camion'), [configsFiltradas]);
  const destinos = useMemo(() => {
    const conteo = new Map<string, number>();
    configsFiltradas.forEach((config) => { const nombre = config.destino_localidad || config.destino_provincia; conteo.set(nombre, (conteo.get(nombre) ?? 0) + 1); });
    return Array.from(conteo.entries()).sort((a, b) => b[1] - a[1]);
  }, [configsFiltradas]);
  const totalDestinos = destinos.reduce((sum, [, cantidad]) => sum + cantidad, 0);
  const colores = ['#2563eb', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];
  const segmentos = destinos.reduce<{ inicio: number; gradientes: string[] }>((acc, [, cantidad], index) => { const fin = acc.inicio + cantidad / Math.max(totalDestinos, 1) * 100; acc.gradientes.push(`${colores[index % colores.length]} ${acc.inicio}% ${fin}%`); acc.inicio = fin; return acc; }, { inicio: 0, gradientes: [] });

  function limpiar() { setOrigenProvincia(''); setOrigenLocalidad(''); setDestinoProvincia(''); setDestinoLocalidad(''); }

  return <div className="space-y-5">
    <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-4 w-4" />Filtros de rutas</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Origen · provincia", origenProvincia, setOrigenProvincia, opciones('origen_provincia')], ["Origen · localidad", origenLocalidad, setOrigenLocalidad, opciones('origen_localidad')], ["Destino · provincia", destinoProvincia, setDestinoProvincia, opciones('destino_provincia')], ["Destino · localidad", destinoLocalidad, setDestinoLocalidad, opciones('destino_localidad')]].map(([label, value, setter, values]) => <label key={label as string} className="text-xs font-medium text-muted-foreground">{label as string}<select className="mt-1 block h-9 w-full rounded-md border bg-white px-2 text-sm text-foreground" value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)}><option value="">Todos</option>{(values as string[]).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>)}</div><button type="button" onClick={limpiar} className="mt-3 text-sm text-primary hover:underline">Limpiar filtros · {configsFiltradas.length} configuraciones</button></CardContent></Card>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Precios por bulto</h2><Resumen datos={barrasBultos} etiqueta="por bulto" /><Card><CardContent className="p-5"><Barras datos={barrasBultos} /></CardContent></Card></section>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Precios por pallet</h2><Resumen datos={barrasPallets} etiqueta="por pallet" /><Card><CardContent className="p-5"><Barras datos={barrasPallets} /></CardContent></Card></section>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Precios por camión completo</h2><Resumen datos={barrasCamion} etiqueta="por camión" /><Card><CardContent className="p-5"><Barras datos={barrasCamion} /></CardContent></Card></section>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><PieChart className="h-5 w-5 text-primary" />Destinos con más configuraciones</h2><Card><CardContent className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-center">{destinos.length ? <div className="h-44 w-44 shrink-0 rounded-full" style={{ background: `conic-gradient(${segmentos.gradientes.join(', ')})` }} aria-label="Distribución de configuraciones por destino" /> : <p className="text-sm text-muted-foreground">No hay destinos para estos filtros.</p>}<div className="grid gap-2 text-sm">{destinos.map(([nombre, cantidad], index) => <div key={nombre} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colores[index % colores.length] }} />{nombre}<span className="text-muted-foreground">{cantidad} configuración{cantidad !== 1 ? 'es' : ''}</span></div>)}</div></CardContent></Card></section>
  </div>;
}
