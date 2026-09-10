'use client';

import { useMemo, useState } from 'react';
import { BarChart3, PieChart, SlidersHorizontal } from 'lucide-react';

const PROVINCIAS_ARGENTINA = [
  { nombre: 'Buenos Aires', x: 60, y: 76 },
  { nombre: 'Córdoba', x: 66, y: 56 },
  { nombre: 'Santa Fe', x: 78, y: 62 },
  { nombre: 'La Pampa', x: 52, y: 63 },
  { nombre: 'Mendoza', x: 39, y: 58 },
  { nombre: 'San Juan', x: 33, y: 49 },
  { nombre: 'Neuquén', x: 28, y: 45 },
  { nombre: 'Río Negro', x: 24, y: 53 },
  { nombre: 'Chubut', x: 17, y: 32 },
  { nombre: 'Santa Cruz', x: 12, y: 20 },
  { nombre: 'Tierra del Fuego', x: 10, y: 9 },
  { nombre: 'Catamarca', x: 47, y: 47 },
  { nombre: 'La Rioja', x: 48, y: 52 },
  { nombre: 'San Luis', x: 43, y: 62 },
  { nombre: 'Santiago del Estero', x: 60, y: 44 },
  { nombre: 'Salta', x: 66, y: 38 },
  { nombre: 'Jujuy', x: 71, y: 30 },
  { nombre: 'Tucumán', x: 58, y: 41 },
  { nombre: 'Formosa', x: 84, y: 49 },
  { nombre: 'Chaco', x: 76, y: 49 },
  { nombre: 'Corrientes', x: 84, y: 60 },
  { nombre: 'Misiones', x: 90, y: 69 },
  { nombre: 'Entre Ríos', x: 82, y: 60 },
];
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatearPrecio, normalizarUbicacion } from '@/lib/calculos/envios';

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

  const opciones = (campo: keyof ReporteConfiguracion) => {
    const valores = new Map<string, string>();
    configuraciones.forEach((config) => {
      const valor = config[campo];
      if (typeof valor === 'string' && valor.trim()) valores.set(normalizarUbicacion(valor), valor);
    });
    return Array.from(valores.values()).sort((a, b) => a.localeCompare(b, 'es'));
  };
  const configsFiltradas = useMemo(() => configuraciones.filter((config) =>
    (!origenProvincia || normalizarUbicacion(config.origen_provincia) === normalizarUbicacion(origenProvincia)) &&
    (!origenLocalidad || normalizarUbicacion(config.origen_localidad) === normalizarUbicacion(origenLocalidad)) &&
    (!destinoProvincia || normalizarUbicacion(config.destino_provincia) === normalizarUbicacion(destinoProvincia)) &&
    (!destinoLocalidad || normalizarUbicacion(config.destino_localidad) === normalizarUbicacion(destinoLocalidad))
  ), [configuraciones, origenProvincia, origenLocalidad, destinoProvincia, destinoLocalidad]);
  const barrasBultos = useMemo(() => construirBarras(configsFiltradas, 'bultos'), [configsFiltradas]);
  const barrasPallets = useMemo(() => construirBarras(configsFiltradas, 'pallets'), [configsFiltradas]);
  const barrasCamion = useMemo(() => construirBarras(configsFiltradas, 'camion'), [configsFiltradas]);
  const destinos = useMemo(() => {
    const conteo = new Map<string, number>();
    configsFiltradas.forEach((config) => {
      const nombre = config.destino_localidad || config.destino_provincia;
      const clave = normalizarUbicacion(nombre);
      const anterior = Array.from(conteo.keys()).find((actual) => normalizarUbicacion(actual) === clave);
      conteo.set(anterior ?? nombre, (conteo.get(anterior ?? nombre) ?? 0) + 1);
    });
    return Array.from(conteo.entries()).sort((a, b) => b[1] - a[1]);
  }, [configsFiltradas]);
  const totalDestinos = destinos.reduce((sum, [, cantidad]) => sum + cantidad, 0);
  const colores = ['#2563eb', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];
  const segmentos = destinos.reduce<{ inicio: number; gradientes: string[] }>((acc, [, cantidad], index) => { const fin = acc.inicio + cantidad / Math.max(totalDestinos, 1) * 100; acc.gradientes.push(`${colores[index % colores.length]} ${acc.inicio}% ${fin}%`); acc.inicio = fin; return acc; }, { inicio: 0, gradientes: [] });

  const mapaProvincias = useMemo(() => {
    const conteoPorProvincia = new Map<string, number>();
    configsFiltradas.forEach((config) => {
      const nombre = config.destino_provincia;
      if (!nombre) return;
      const clave = normalizarUbicacion(nombre);
      const actual = Array.from(conteoPorProvincia.keys()).find((actualKey) => normalizarUbicacion(actualKey) === clave);
      const key = actual ?? nombre;
      conteoPorProvincia.set(key, (conteoPorProvincia.get(key) ?? 0) + 1);
    });

    return PROVINCIAS_ARGENTINA.map((provincia) => {
      const matchKey = Array.from(conteoPorProvincia.keys()).find((key) => normalizarUbicacion(key) === normalizarUbicacion(provincia.nombre));
      const cantidad = matchKey ? conteoPorProvincia.get(matchKey) ?? 0 : 0;
      return { ...provincia, cantidad };
    });
  }, [configsFiltradas]);

  function limpiar() { setOrigenProvincia(''); setOrigenLocalidad(''); setDestinoProvincia(''); setDestinoLocalidad(''); }

  return <div className="space-y-5">
    <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-4 w-4" />Filtros de rutas</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Origen · provincia", origenProvincia, setOrigenProvincia, opciones('origen_provincia')], ["Origen · localidad", origenLocalidad, setOrigenLocalidad, opciones('origen_localidad')], ["Destino · provincia", destinoProvincia, setDestinoProvincia, opciones('destino_provincia')], ["Destino · localidad", destinoLocalidad, setDestinoLocalidad, opciones('destino_localidad')]].map(([label, value, setter, values]) => <label key={label as string} className="text-xs font-medium text-muted-foreground">{label as string}<select className="mt-1 block h-9 w-full rounded-md border bg-white px-2 text-sm text-foreground" value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)}><option value="">Todos</option>{(values as string[]).map((option) => <option key={option} value={option}>{option}</option>)}</select></label>)}</div><button type="button" onClick={limpiar} className="mt-3 text-sm text-primary hover:underline">Limpiar filtros · {configsFiltradas.length} configuraciones</button></CardContent></Card>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Precios por bulto</h2><Resumen datos={barrasBultos} etiqueta="por bulto" /><Card><CardContent className="p-5"><Barras datos={barrasBultos} /></CardContent></Card></section>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Precios por pallet</h2><Resumen datos={barrasPallets} etiqueta="por pallet" /><Card><CardContent className="p-5"><Barras datos={barrasPallets} /></CardContent></Card></section>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Precios por camión completo</h2><Resumen datos={barrasCamion} etiqueta="por camión" /><Card><CardContent className="p-5"><Barras datos={barrasCamion} /></CardContent></Card></section>
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><PieChart className="h-5 w-5 text-primary" />Destinos con más configuraciones</h2>
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr] xl:items-center">
            <div className="relative overflow-hidden rounded-xl border bg-slate-50 p-3">
              <svg viewBox="0 0 100 100" className="h-[340px] w-full" role="img" aria-label="Mapa mínimo de Argentina con concentración por provincia">
                <rect x="0" y="0" width="100" height="100" fill="#f8fafc" />
                <path d="M14 63 L18 54 L22 48 L27 42 L30 33 L36 27 L42 21 L50 15 L58 13 L66 14 L73 18 L80 23 L86 30 L91 39 L94 48 L90 58 L85 65 L81 72 L74 79 L66 86 L58 89 L50 86 L42 81 L35 77 L28 72 L22 69 L18 67 Z" fill="#dfe7e7" stroke="#a8b4b4" strokeWidth="0.7" />
                <path d="M34 58 L42 56 L47 60 L46 67 L39 69 Z" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="0.5" />
                <path d="M47 46 L56 42 L62 46 L62 52 L54 54 L48 52 Z" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="0.5" />
                <path d="M62 28 L71 29 L77 34 L75 39 L67 39 L62 34 Z" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="0.5" />
                {mapaProvincias.map((provincia) => {
                  if (!provincia.cantidad) return null;
                  const intensidad = Math.min(1, provincia.cantidad / Math.max(4, ...mapaProvincias.map((item) => item.cantidad), 1));
                  const radio = 1.9 + intensidad * 2.5;
                  return (
                    <g key={provincia.nombre}>
                      <circle cx={provincia.x} cy={provincia.y} r={radio} fill={`rgba(15, 118, 110, ${0.25 + intensidad * 0.65})`} stroke="#0f766e" strokeWidth="0.35" />
                      <text x={provincia.x + 2.3} y={provincia.y - 2.2} fontSize="2.8" fill="#0f172a" fontWeight="700">{provincia.cantidad}</text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="space-y-3">
              {destinos.length ? (
                <div className="flex flex-wrap gap-2">
                  {destinos.map(([nombre, cantidad], index) => (
                    <div key={nombre} className="flex items-center gap-2 rounded-full border bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colores[index % colores.length] }} />
                      <span>{nombre}</span>
                      <span className="font-semibold text-slate-900">{cantidad}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No hay destinos para estos filtros.</p>
              )}

              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                {destinos.length ? (
                  <div className="flex h-full w-full">
                    {destinos.map(([nombre, cantidad], index) => {
                      const porcentaje = (cantidad / Math.max(totalDestinos, 1)) * 100;
                      return (
                        <div key={nombre} className="h-full" style={{ width: `${porcentaje}%`, backgroundColor: colores[index % colores.length] }} />
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2 text-sm">
                {destinos.map(([nombre, cantidad], index) => (
                  <div key={nombre} className="flex items-center justify-between gap-3 rounded border bg-white px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colores[index % colores.length] }} />
                      <span className="truncate">{nombre}</span>
                    </div>
                    <span className="text-muted-foreground">{cantidad} config.</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  </div>;
}
