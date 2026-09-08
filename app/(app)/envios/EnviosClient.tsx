'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import { useToast } from '@/hooks/use-toast';
import {
  filtrarConfiguraciones,
  extraerTags,
  calcularPrecio,
  calcularRanking,
  formatearPrecio,
  formatearTiempo,
  type ConfiguracionConDatos,
} from '@/lib/calculos/envios';
import type {
  Tag, ResultadoEnvio, UbicacionSeleccionada, BusquedaEnvio,
} from '@/lib/types/database';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { EmptyState } from '@/components/layout/EmptyState';
import {
  Search, ArrowLeftRight, Package, Truck, Clock,
  Star, DollarSign, Loader2, Info, Minus, Plus,
  X,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

type OrdenCriterio = 'recomendado' | 'precio' | 'tiempo';

const ULTIMA_BUSQUEDA_KEY = 'tarifario:ultima-busqueda';

interface PerfilDefaults {
  origen_predeterminado_provincia: string | null;
  origen_predeterminado_localidad: string | null;
  destino_predeterminado_provincia: string | null;
  destino_predeterminado_localidad: string | null;
}

interface EnviosClientProps {
  configuracionesRaw: unknown[];
  tagsDisponibles: Tag[];
  perfilDefaults: PerfilDefaults | null;
}

function buildUbicacion(p: string | null, l: string | null): UbicacionSeleccionada | null {
  if (!p) return null;
  return { provincia: p, localidad: l ?? null };
}

function labelPallets(n: number): string {
  if (n === 0.5) return '½ pallet';
  if (n === 1) return '1 pallet';
  if (n === 1.5) return '1½ pallets';
  if (Number.isInteger(n)) return `${n} pallets`;
  return `${n} pallets`;
}

function estadoActualizacion(fecha: string | null | undefined): { color: string; etiqueta: string } {
  if (!fecha) return { color: 'bg-red-500', etiqueta: 'Sin fecha registrada' };
  const dias = (Date.now() - new Date(fecha).getTime()) / 86400000;
  if (dias <= 30) return { color: 'bg-green-500', etiqueta: 'Actualizada recientemente' };
  if (dias <= 60) return { color: 'bg-yellow-400', etiqueta: 'Revisar actualización' };
  return { color: 'bg-red-500', etiqueta: 'Desactualizada' };
}

function formatearFechaActualizacion(fecha: string | null | undefined): string {
  return fecha
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(fecha))
    : 'Sin fecha registrada';
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function EnviosClient({ configuracionesRaw, tagsDisponibles, perfilDefaults }: EnviosClientProps) {
  const { toast } = useToast();

  // ── Formulario ─────────────────────────────────────────────────────────────
  const [origen, setOrigen] = useState<UbicacionSeleccionada | null>(
    buildUbicacion(perfilDefaults?.origen_predeterminado_provincia ?? null, perfilDefaults?.origen_predeterminado_localidad ?? null)
  );
  const [destino, setDestino] = useState<UbicacionSeleccionada | null>(
    buildUbicacion(perfilDefaults?.destino_predeterminado_provincia ?? null, perfilDefaults?.destino_predeterminado_localidad ?? null)
  );

  // Bultos: activado/desactivado + cantidad (número libre)
  const [incluyeBultos, setIncluyeBultos] = useState(false);
  const [cantBultosStr, setCantBultosStr] = useState('1'); // string para no limpiar el input

  // Pallets: activado/desactivado + valor discreto del preset
  const [incluyePallets, setIncluyePallets] = useState(false);
  const [cantPallets, setCantPallets] = useState<number>(1);

  // Camión completo
  const [camionCompleto, setCamionCompleto] = useState(false);
  // Peritoneal
  const [soloPeritoneal, setSoloPeritoneal] = useState(false);

  // ── Resultados ─────────────────────────────────────────────────────────────
  const [resultados, setResultados] = useState<ResultadoEnvio[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [orden, setOrden] = useState<OrdenCriterio>('recomendado');
  const [filtroTags, setFiltroTags] = useState<string[]>([]);

  useEffect(() => {
    try {
      const guardada = sessionStorage.getItem(ULTIMA_BUSQUEDA_KEY);
      if (!guardada) return;

      const estado = JSON.parse(guardada) as {
        origen: UbicacionSeleccionada | null;
        destino: UbicacionSeleccionada | null;
        incluyeBultos: boolean;
        cantBultosStr: string;
        incluyePallets: boolean;
        cantPallets: number;
        camionCompleto: boolean;
        soloPeritoneal: boolean;
        resultados: ResultadoEnvio[] | null;
        orden: OrdenCriterio;
        filtroTags: string[];
      };

      setOrigen(estado.origen);
      setDestino(estado.destino);
      setIncluyeBultos(estado.incluyeBultos);
      setCantBultosStr(estado.cantBultosStr);
      setIncluyePallets(estado.incluyePallets);
      setCantPallets(estado.cantPallets);
      setCamionCompleto(estado.camionCompleto);
      setSoloPeritoneal(estado.soloPeritoneal);
      setResultados(estado.resultados);
      setOrden(estado.orden);
      setFiltroTags(estado.filtroTags);
    } catch {
      sessionStorage.removeItem(ULTIMA_BUSQUEDA_KEY);
    }
  }, []);

  function swap() {
    const tmp = origen; setOrigen(destino); setDestino(tmp);
  }

  // ── Validar cantidad de bultos ─────────────────────────────────────────────
  const cantBultosNum = Math.max(1, parseInt(cantBultosStr) || 1);

  // ── Buscar ─────────────────────────────────────────────────────────────────
  const buscar = useCallback(() => {
    if (!origen?.provincia) { toast({ variant: 'destructive', title: 'Seleccioná el origen.' }); return; }
    if (!destino?.provincia) { toast({ variant: 'destructive', title: 'Seleccioná el destino.' }); return; }
    if (!incluyeBultos && !incluyePallets && !camionCompleto) {
      toast({ variant: 'destructive', title: 'Indicá al menos un tipo de carga.' });
      return;
    }

    setBuscando(true);
    try {
      const busqueda: BusquedaEnvio = {
        origen: origen!,
        destino: destino!,
        cantidadBultos: incluyeBultos ? cantBultosNum : 0,
        cantidadPallets: incluyePallets ? cantPallets : 0,
        camionCompleto,
        soloPeritoneal,
      };
      const configs = configuracionesRaw as ConfiguracionConDatos[];
      const candidatos = filtrarConfiguraciones(configs, busqueda).filter((config) => {
        if (filtroTags.length === 0) return true;
        const configTags = extraerTags(config);
        return filtroTags.every((tagId) => configTags.some((tag) => tag.id === tagId));
      });
      const conPrecios = candidatos.map((config) => ({
        config,
        desglose: calcularPrecio(config, busqueda),
      }));
      const nuevosResultados = calcularRanking(conPrecios);
      setResultados(nuevosResultados);
      setOrden('recomendado');
      sessionStorage.setItem(ULTIMA_BUSQUEDA_KEY, JSON.stringify({
        origen,
        destino,
        incluyeBultos,
        cantBultosStr,
        incluyePallets,
        cantPallets,
        camionCompleto,
        soloPeritoneal,
        resultados: nuevosResultados,
        orden: 'recomendado',
        filtroTags: [],
      }));
    } catch {
      toast({ variant: 'destructive', title: 'Error al calcular resultados.' });
    } finally {
      setBuscando(false);
    }
  }, [origen, destino, incluyeBultos, cantBultosStr, cantBultosNum, incluyePallets, cantPallets, camionCompleto, soloPeritoneal, filtroTags, configuracionesRaw, toast]);

  // ── Ordenar / filtrar resultados ───────────────────────────────────────────
  const resultadosOrdenados = useMemo(() => {
    if (!resultados) return [];
    let filtrados = resultados;
    if (filtroTags.length > 0) {
      filtrados = resultados.filter((r) => filtroTags.some((id) => r.tags.some((t) => t.id === id)));
    }
    if (orden === 'precio') return [...filtrados].sort((a, b) => a.precioTotal - b.precioTotal);
    if (orden === 'tiempo') {
      return [...filtrados].sort((a, b) => {
        const ta = ((a.tiempoMin ?? 0) + (a.tiempoMax ?? a.tiempoMin ?? 0)) / 2;
        const tb = ((b.tiempoMin ?? 0) + (b.tiempoMax ?? b.tiempoMin ?? 0)) / 2;
        return ta - tb;
      });
    }
    return filtrados;
  }, [resultados, orden, filtroTags]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">

        {/* Origen / Destino */}
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <GeorefCombobox label="Origen" value={origen} onChange={setOrigen} placeholder="Seleccionar provincia..." />
          </div>
          <Button type="button" variant="outline" size="icon" onClick={swap} className="shrink-0 mb-0.5" aria-label="Intercambiar">
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <GeorefCombobox label="Destino" value={destino} onChange={setDestino} placeholder="Seleccionar provincia..." />
          </div>
        </div>

        <Separator />

        {/* Carga */}
        <div>
          <Label className="mb-3 block text-sm font-medium">¿Qué vas a enviar?</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* ── Bultos ── */}
            <div className={`rounded-xl border-2 p-3 transition-colors ${incluyeBultos ? 'border-primary bg-primary/5' : 'border-border'}`}>
              {/* Header — solo el click acá activa/desactiva */}
              <button
                type="button"
                className="w-full flex items-center justify-between mb-2"
                onClick={() => setIncluyeBultos((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Bultos</span>
                </div>
                <span className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${incluyeBultos ? 'bg-primary border-primary' : 'border-slate-300'}`}>
                  {incluyeBultos && <span className="text-white text-xs font-bold">✓</span>}
                </span>
              </button>
              {/* Input — independiente del toggle */}
              {incluyeBultos && (
                <div className="flex items-center gap-1 mt-1">
                  <button type="button" onClick={() => setCantBultosStr(String(Math.max(1, cantBultosNum - 1)))}
                    className="h-8 w-8 rounded border flex items-center justify-center hover:bg-slate-100 shrink-0">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <Input
                    type="number" min={1}
                    value={cantBultosStr}
                    onChange={(e) => setCantBultosStr(e.target.value)}
                    onBlur={() => setCantBultosStr(String(Math.max(1, parseInt(cantBultosStr) || 1)))}
                    className="h-8 text-sm text-center"
                  />
                  <button type="button" onClick={() => setCantBultosStr(String(cantBultosNum + 1))}
                    className="h-8 w-8 rounded border flex items-center justify-center hover:bg-slate-100 shrink-0">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {incluyeBultos && (
                <p className="text-xs text-muted-foreground mt-1.5 text-center">
                  {cantBultosNum} bulto{cantBultosNum !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* ── Pallets — selector discreto ── */}
            <div className={`rounded-xl border-2 p-3 transition-colors ${incluyePallets ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <button
                type="button"
                className="w-full flex items-center justify-between mb-2"
                onClick={() => setIncluyePallets((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold bg-slate-200 text-slate-600 rounded px-1.5 py-0.5">P</span>
                  <span className="text-sm font-medium">Pallets</span>
                </div>
                <span className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${incluyePallets ? 'bg-primary border-primary' : 'border-slate-300'}`}>
                  {incluyePallets && <span className="text-white text-xs font-bold">✓</span>}
                </span>
              </button>
              {/* Selector de preset — no afecta el toggle */}
              {incluyePallets && (
                <div className="mt-1 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <button type="button"
                      onClick={() => setCantPallets((cantidad) => Math.max(0.5, Number((cantidad - 0.5).toFixed(2))))}
                      disabled={cantPallets <= 0.5}
                      className="h-8 w-8 rounded border flex items-center justify-center hover:bg-slate-100 shrink-0 disabled:opacity-40">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <Input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={cantPallets}
                      onChange={(event) => {
                        const valor = Number(event.target.value);
                        if (Number.isFinite(valor) && valor >= 0.5) setCantPallets(valor);
                      }}
                      className="h-8 flex-1 text-center text-sm font-semibold"
                      aria-label="Cantidad de pallets"
                    />
                    <button type="button"
                      onClick={() => setCantPallets((cantidad) => Number((cantidad + 0.5).toFixed(2)))}
                      className="h-8 w-8 rounded border flex items-center justify-center hover:bg-slate-100 shrink-0 disabled:opacity-40">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 text-center">Ingresá cualquier cantidad, por ejemplo 15 o 17 pallets.</p>
                </div>
              )}
            </div>

            {/* ── Camión completo ── */}
            <div className={`rounded-xl border-2 p-3 transition-colors ${camionCompleto ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <button
                type="button"
                className="w-full flex items-center justify-between"
                onClick={() => setCamionCompleto((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Camión completo</span>
                </div>
                <span className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${camionCompleto ? 'bg-primary border-primary' : 'border-slate-300'}`}>
                  {camionCompleto && <span className="text-white text-xs font-bold">✓</span>}
                </span>
              </button>
              {camionCompleto && (
                <p className="text-xs text-muted-foreground mt-2">Precio fijo por viaje completo</p>
              )}
            </div>
          </div>

          {tagsDisponibles.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label className="text-sm font-medium">Filtrar por Tags <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                {filtroTags.length > 0 && <button type="button" onClick={() => setFiltroTags([])} className="text-xs text-primary hover:underline">Quitar todos</button>}
              </div>
              <div className="flex flex-wrap gap-2">
                {tagsDisponibles.map((tag) => {
                  const activo = filtroTags.includes(tag.id);
                  return (
                    <button key={tag.id} type="button" onClick={() => setFiltroTags((actuales) => activo ? actuales.filter((id) => id !== tag.id) : [...actuales, tag.id])}
                      className="inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-medium transition-colors"
                      style={activo ? { backgroundColor: tag.color, borderColor: tag.color, color: 'white' } : { borderColor: tag.color, color: tag.color }}>
                      {tag.nombre}{activo && <X className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
              {filtroTags.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Se mostrarán configuraciones que tengan todos los Tags seleccionados.</p>}
            </div>
          )}

          {/* Resumen */}
          {(incluyeBultos || incluyePallets || camionCompleto) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {incluyeBultos && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                  <Package className="h-3 w-3" />{cantBultosNum} bulto{cantBultosNum !== 1 ? 's' : ''}
                </span>
              )}
              {incluyePallets && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                  <span className="text-[10px] font-bold">P</span>{labelPallets(cantPallets)}
                </span>
              )}
              {camionCompleto && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                  <Truck className="h-3 w-3" />Camión completo
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <button
            type="button"
            onClick={() => setSoloPeritoneal((v) => !v)}
            className="flex items-center gap-2.5 group"
            aria-pressed={soloPeritoneal}
          >
            <span className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${soloPeritoneal ? 'bg-primary border-primary' : 'border-slate-300 group-hover:border-slate-400'}`}>
              {soloPeritoneal && <span className="text-white text-xs font-bold">✓</span>}
            </span>
            <span className="text-sm text-slate-700">
              Solo transportes <span className="font-medium text-blue-700">aptos para peritoneal</span>
            </span>
          </button>

          <Button onClick={buscar} disabled={buscando} size="lg" className="w-full sm:w-auto">
            {buscando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Buscar transportes
          </Button>
        </div>
      </div>

      {/* Resultados */}
      {resultados !== null && (
        <div>
          {resultados.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
                {([
                  { value: 'recomendado', label: 'Recomendado', icon: Star },
                  { value: 'precio', label: 'Mejor precio', icon: DollarSign },
                  { value: 'tiempo', label: 'Más rápido', icon: Clock },
                ] as { value: OrdenCriterio; label: string; icon: typeof Star }[]).map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" onClick={() => setOrden(value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${orden === value ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-slate-100'}`}>
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:block">{label}</span>
                  </button>
                ))}
              </div>

              <div className="ml-auto text-sm text-muted-foreground self-center">
                {resultadosOrdenados.length} resultado{resultadosOrdenados.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {resultadosOrdenados.length === 0 ? (
            <EmptyState icon={Search} title="Sin resultados"
              description={filtroTags.length > 0 ? 'Ningún transporte tiene esas tags.' : 'No hay transportes configurados para esta ruta y tipo de carga.'}
              action={filtroTags.length > 0 ? <Button variant="outline" onClick={() => setFiltroTags([])}>Quitar filtros</Button> : undefined}
            />
          ) : (
            <div className="space-y-3">
              {resultadosOrdenados.map((resultado, idx) => (
                <ResultadoCard key={resultado.configuracion.id} resultado={resultado} posicion={idx}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tarjeta de resultado ─────────────────────────────────────────────────────

interface ResultadoCardProps {
  resultado: ResultadoEnvio;
  posicion: number;
}

function ResultadoCard({ resultado, posicion }: ResultadoCardProps) {
  const { transporte, tags, precioTotal, tiempoMin, tiempoMax, desglose } = resultado;
  const esBest = posicion === 0;
  const estado = estadoActualizacion(resultado.configuracion.updated_at);

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-all ${esBest ? 'border-primary/30 ring-1 ring-primary/10' : ''}`}>
      {esBest && (
        <div className="bg-primary/5 border-b border-primary/10 px-4 py-1.5 flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-primary fill-primary" />
          <span className="text-xs font-semibold text-primary">Mejor opción</span>
        </div>
      )}
      <div className="p-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <Link href={`/transportes/${transporte.id}`} className="font-semibold text-slate-900 text-base hover:text-primary hover:underline">
              {transporte.nombre_fantasia || transporte.razon_social}
            </Link>
            {transporte.nombre_fantasia && <p className="text-xs text-muted-foreground">{transporte.razon_social}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {resultado.configuracion.origen_localidad || resultado.configuracion.origen_provincia}
              <span className="mx-1.5 text-slate-400">→</span>
              {resultado.configuracion.destino_localidad || resultado.configuracion.destino_provincia}
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-4">
            <div>
              <span className="text-2xl font-bold text-slate-900">{formatearPrecio(precioTotal)}</span>
              <span className="text-xs text-muted-foreground ml-1">total</span>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Precio aproximado (sin IVA y sin seguro)</p>
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />{formatearTiempo(tiempoMin, tiempoMax)}
            </div>
          </div>
          {(tags.length > 0 || resultado.configuracion.apto_peritoneal) && (
            <div className="flex flex-wrap gap-1.5">
              {resultado.configuracion.apto_peritoneal && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border border-blue-300 text-blue-700 bg-blue-50">
                  Apto peritoneal
                </span>
              )}
              {tags.map((tag) => (
                <span key={tag.id} className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
                  {tag.nombre}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-start justify-end pt-1">
          <div className="flex items-center gap-2 text-right" title={estado.etiqueta}>
            <div>
              <p className="text-[11px] text-muted-foreground">Actualizada</p>
              <p className="text-xs font-medium text-slate-600">{formatearFechaActualizacion(resultado.configuracion.updated_at)}</p>
            </div>
            <span className={`h-4 w-4 rounded-full ${estado.color} ring-2 ring-white shadow-sm`} aria-label={estado.etiqueta} />
          </div>
        </div>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="d" className="border-t border-dashed">
          <AccordionTrigger className="px-4 py-2 text-xs text-muted-foreground hover:text-slate-700 hover:no-underline">
            <span className="flex items-center gap-1.5"><Info className="h-3.5 w-3.5" />Ver desglose del cálculo</span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
              {desglose.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.descripcion}</span>
                  <span className="font-medium tabular-nums">{formatearPrecio(item.subtotal)}</span>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="text-primary">{formatearPrecio(desglose.total)}</span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
