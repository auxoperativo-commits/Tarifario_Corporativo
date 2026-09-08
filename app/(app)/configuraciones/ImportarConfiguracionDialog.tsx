'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import type { Transporte } from '@/lib/types/database';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileSpreadsheet, Loader2, Upload, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FilaImportacion {
  fila: number;
  transporte: Transporte;
  origen: string;
  destino: string;
  localidadDestino: string | null;
  localidadPendiente: string | null;
  precioBulto: number;
  precioPallet: number;
}

interface ErrorImportacion {
  fila?: number;
  mensaje: string;
  transporte?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transportes: Transporte[];
  onImported: (transporteId: string) => Promise<void>;
}

const COLUMNAS = {
  transporte: 'nombre de transporte',
  origen: 'origen',
  destino: 'destino',
  localidadDestino: 'localidad destino',
  bulto: 'precio x bulto',
  pallet: 'precio x pallet',
};

function normalizar(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parsearPrecio(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const texto = String(value ?? '').trim().replace(/\s/g, '');
  if (!texto) return null;
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto.replace(/\.(?=\d{3}(?:\D|$))/g, '');
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function buscarTransporte(nombre: string, transportes: Transporte[]): Transporte[] {
  const buscado = normalizar(nombre);
  return transportes.filter((transporte) =>
    [transporte.razon_social, transporte.nombre_fantasia].some((valor) => valor && normalizar(valor) === buscado)
  );
}

function claveRuta(transporteId: string, origen: string, destino: string): string {
  return `${transporteId}|${normalizar(origen)}|${normalizar(destino)}`;
}

async function resolverLocalidad(nombre: string, provincia: string): Promise<string | null> {
  if (!nombre.trim()) return null;
  const params = new URLSearchParams({ nombre: nombre.trim(), provincia, max: '20', orden: 'nombre' });
  try {
    const response = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?${params}`);
    if (!response.ok) return null;
    const data = await response.json() as { localidades?: { nombre: string }[] };
    return data.localidades?.find((localidad) => normalizar(localidad.nombre) === normalizar(nombre))?.nombre ?? null;
  } catch {
    return null;
  }
}

function claveConfiguracion(transporteId: string, origen: string, destino: string, localidadDestino: string | null): string {
  return `${claveRuta(transporteId, origen, destino)}|${normalizar(localidadDestino)}`;
}

export function ImportarConfiguracionDialog({ open, onOpenChange, transportes, onImported }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [filas, setFilas] = useState<FilaImportacion[]>([]);
  const [errores, setErrores] = useState<ErrorImportacion[]>([]);
  const [archivo, setArchivo] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);

  function limpiar() {
    setFilas([]);
    setErrores([]);
    setArchivo('');
  }

  function cerrar(openState: boolean) {
    if (!openState && !leyendo && !importando) limpiar();
    onOpenChange(openState);
  }

  async function leerArchivo(file: File) {
    setLeyendo(true);
    setArchivo(file.name);
    setFilas([]);
    setErrores([]);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const primeraHoja = workbook.Sheets[workbook.SheetNames[0]];
      if (!primeraHoja) throw new Error('El archivo no contiene hojas de cálculo.');
      const filasCrudas = XLSX.utils.sheet_to_json<Record<string, unknown>>(primeraHoja, { defval: '' });
      if (!filasCrudas.length) throw new Error('La hoja está vacía.');

      const encabezados = Object.keys(filasCrudas[0]).reduce<Record<string, string>>((acc, encabezado) => {
        acc[normalizar(encabezado)] = encabezado;
        return acc;
      }, {});
      const faltantes = Object.values(COLUMNAS).filter((columna) => !encabezados[columna]);
      if (faltantes.length) throw new Error(`Faltan columnas obligatorias: ${faltantes.join(', ')}.`);

      const nuevasFilas: FilaImportacion[] = [];
      const nuevosErrores: ErrorImportacion[] = [];
      const clavesArchivo = new Set<string>();

      for (let index = 0; index < filasCrudas.length; index += 1) {
        const fila = filasCrudas[index];
        const numeroFila = index + 2;
        const nombre = String(fila[encabezados[COLUMNAS.transporte]] ?? '').trim();
        const origen = String(fila[encabezados[COLUMNAS.origen]] ?? '').trim();
        const destino = String(fila[encabezados[COLUMNAS.destino]] ?? '').trim();
        const localidadOriginal = String(fila[encabezados[COLUMNAS.localidadDestino]] ?? '').trim();
        const precioBulto = parsearPrecio(fila[encabezados[COLUMNAS.bulto]]);
        const precioPallet = parsearPrecio(fila[encabezados[COLUMNAS.pallet]]);
        if (!nombre && !origen && !destino && precioBulto === null && precioPallet === null) continue;

        const problemas: string[] = [];
        if (!nombre) problemas.push('falta el nombre del transporte');
        if (!origen) problemas.push('falta el origen');
        if (!destino) problemas.push('falta el destino');
        if (precioBulto === null) problemas.push('el precio x bulto debe ser un número mayor o igual a 0');
        if (precioPallet === null) problemas.push('el precio x pallet debe ser un número mayor o igual a 0');
        const coincidencias = buscarTransporte(nombre, transportes);
        if (nombre && coincidencias.length === 0) problemas.push(`el transporte "${nombre}" no está registrado`);
        if (coincidencias.length > 1) problemas.push(`"${nombre}" coincide con más de un transporte`);
        const transporte = coincidencias[0];
        if (transporte && !transporte.activo) problemas.push('el transporte está inactivo');
        const localidadDestino = transporte ? await resolverLocalidad(localidadOriginal, destino) : null;
        const clave = transporte && claveConfiguracion(transporte.id, origen, destino, localidadDestino ?? (localidadOriginal || null));
        if (clave && clavesArchivo.has(clave)) problemas.push('la ruta está repetida dentro del archivo');
        if (clave) clavesArchivo.add(clave);
        if (problemas.length) {
          nuevosErrores.push({ fila: numeroFila, mensaje: problemas.join('; '), transporte: nombre });
          return;
        }
        nuevasFilas.push({ fila: numeroFila, transporte: transporte!, origen, destino, localidadDestino, localidadPendiente: localidadOriginal && !localidadDestino ? localidadOriginal : null, precioBulto: precioBulto!, precioPallet: precioPallet! });
      }

      if (!nuevasFilas.length && !nuevosErrores.length) throw new Error('No se encontraron filas con datos.');
      if (nuevasFilas.length) {
        const ids = Array.from(new Set(nuevasFilas.map((fila) => fila.transporte.id)));
        const { data: configuraciones, error } = await supabase
          .from('configuraciones_envio')
          .select('transporte_id, origen_provincia, destino_provincia, destino_localidad')
          .in('transporte_id', ids);
        if (error) throw error;
        const existentes = new Set((configuraciones ?? []).map((config) => claveConfiguracion(config.transporte_id, config.origen_provincia, config.destino_provincia, config.destino_localidad)));
        nuevasFilas.forEach((fila) => {
          if (!fila.localidadPendiente && existentes.has(claveConfiguracion(fila.transporte.id, fila.origen, fila.destino, fila.localidadDestino))) {
            nuevosErrores.push({ fila: fila.fila, mensaje: 'ya existe una configuración para ese transporte y esa ruta', transporte: fila.transporte.nombre_fantasia || fila.transporte.razon_social });
          }
        });
      }
      setFilas(nuevasFilas.filter((fila) => !nuevosErrores.some((error) => error.fila === fila.fila)));
      setErrores(nuevosErrores);
    } catch (error) {
      setErrores([{ mensaje: error instanceof Error ? error.message : 'No se pudo leer el archivo.' }]);
    } finally {
      setLeyendo(false);
    }
  }

  async function importar() {
    if (errores.length || !filas.length) return;
    setImportando(true);
    const configuracionesCreadas: string[] = [];
    try {
      const ids = Array.from(new Set(filas.map((fila) => fila.transporte.id)));
      const { data: existentes, error: errorExistentes } = await supabase
        .from('configuraciones_envio')
        .select('transporte_id, origen_provincia, destino_provincia, destino_localidad')
        .in('transporte_id', ids);
      if (errorExistentes) throw errorExistentes;
      const clavesFinales = new Set<string>();
      for (const fila of filas) {
        const clave = claveConfiguracion(fila.transporte.id, fila.origen, fila.destino, fila.localidadDestino);
        if (clavesFinales.has(clave) || (existentes ?? []).some((config) => claveConfiguracion(config.transporte_id, config.origen_provincia, config.destino_provincia, config.destino_localidad) === clave)) {
          throw new Error(`La fila ${fila.fila} duplica una configuración existente o repetida: ${fila.destino}${fila.localidadDestino ? ` · ${fila.localidadDestino}` : ''}.`);
        }
        clavesFinales.add(clave);
      }
      for (const fila of filas) {
        const fechaActualizacion = new Date().toISOString();
        const { data: configuracion, error: configError } = await supabase.from('configuraciones_envio').insert({
          transporte_id: fila.transporte.id,
          origen_provincia: fila.origen,
          origen_localidad: null,
          destino_provincia: fila.destino,
          destino_localidad: fila.localidadDestino,
          tiempo_estimado_min_horas: null,
          tiempo_estimado_max_horas: null,
          precio_pallet: null,
          precio_camion_completo: null,
          precio_camion_actualizado_at: null,
          apto_peritoneal: false,
          activo: true,
        }).select('id').single();
        if (configError || !configuracion) throw configError ?? new Error(`No se pudo crear la fila ${fila.fila}.`);
        configuracionesCreadas.push(configuracion.id);
        const { error: bultoError } = await supabase.from('tarifas_bulto').insert({ configuracion_id: configuracion.id, desde_bulto: 1, precio: fila.precioBulto, es_valor_inicial: false, updated_at: fechaActualizacion });
        if (bultoError) throw bultoError;
        const { error: palletError } = await supabase.from('tarifas_pallet').insert({ configuracion_id: configuracion.id, desde_pallet: 1, precio: fila.precioPallet, updated_at: fechaActualizacion });
        if (palletError) throw palletError;
      }
      const primerTransporte = filas[0].transporte.id;
      await onImported(primerTransporte);
      toast({ title: `${filas.length} configuración${filas.length === 1 ? '' : 'es'} importada${filas.length === 1 ? '' : 's'}.` });
      limpiar();
      onOpenChange(false);
    } catch (error) {
      if (configuracionesCreadas.length > 0) {
        await supabase.from('configuraciones_envio').delete().in('id', configuracionesCreadas);
      }
      toast({ variant: 'destructive', title: 'La importación se detuvo', description: error instanceof Error ? error.message : 'Error inesperado.' });
    } finally {
      setImportando(false);
    }
  }

  const transportesNoRegistrados = errores.filter((error) => error.mensaje.includes('no está registrado'));
  const filasPendientes = filas.filter((fila) => fila.localidadPendiente);
  const actualizarLocalidad = (filaNumero: number, localidad: string | null, confirmada: boolean) => {
    setFilas((actuales) => actuales.map((fila) => fila.fila === filaNumero ? { ...fila, localidadDestino: localidad, localidadPendiente: confirmada ? null : fila.localidadPendiente } : fila));
  };

  return <Dialog open={open} onOpenChange={cerrar}>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" />Importar configuraciones</DialogTitle>
        <DialogDescription>Usá las columnas NOMBRE DE TRANSPORTE, ORIGEN, DESTINO, LOCALIDAD DESTINO, PRECIO X BULTO y PRECIO X PALLET. La localidad destino es opcional y puede corregirse en la vista previa.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="rounded-lg border-2 border-dashed p-5 text-center">
          <Input id="archivo-importacion" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => event.target.files?.[0] && leerArchivo(event.target.files[0])} />
          <Label htmlFor="archivo-importacion" className="cursor-pointer"><Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" /><span className="font-medium">Seleccionar Excel</span><span className="mt-1 block text-xs text-muted-foreground">También acepta CSV · {archivo || 'ningún archivo seleccionado'}</span></Label>
        </div>
        {leyendo && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Validando archivo...</div>}
        {transportesNoRegistrados.length > 0 && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-semibold">Hay transportes no registrados</p><p className="mt-1">{transportesNoRegistrados.map((error) => `Fila ${error.fila}: ${error.transporte}`).join(' · ')}</p><Button size="sm" variant="outline" className="mt-3" onClick={() => { onOpenChange(false); router.push('/transportes'); }}><UserPlus className="mr-2 h-4 w-4" />Registrar transporte</Button></div>}
        {errores.length > 0 && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive"><p className="font-semibold">No se puede importar todavía</p><ul className="mt-1 list-disc pl-5 text-sm">{errores.map((error, index) => <li key={`${error.fila}-${index}`}>{error.fila ? `Fila ${error.fila}: ` : ''}{error.mensaje}</li>)}</ul></div>}
        {filas.length > 0 && <div className="rounded-lg border p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Vista previa</p><Badge>{filas.length} fila{filas.length !== 1 ? 's' : ''}</Badge></div>{filasPendientes.length > 0 && <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">Revisá las localidades marcadas. Podés seleccionarlas desde Georef o dejarlas como “Sin localidad”.</p>}<div className="max-h-[28rem] overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-2">Transporte</th><th className="p-2">Origen</th><th className="p-2">Destino</th><th className="p-2 min-w-[240px]">Localidad destino</th><th className="p-2">Bulto 1</th><th className="p-2">Pallet 1</th></tr></thead><tbody>{filas.map((fila) => <tr key={fila.fila} className="border-b align-top last:border-0"><td className="p-2">{fila.transporte.nombre_fantasia || fila.transporte.razon_social}</td><td className="p-2">{fila.origen}</td><td className="p-2">{fila.destino}</td><td className="p-2"><GeorefCombobox label="" value={{ provincia: fila.destino, localidad: fila.localidadDestino }} onChange={(ubicacion) => actualizarLocalidad(fila.fila, ubicacion?.localidad ?? null, Boolean(ubicacion?.localidad))} localidadOpcional placeholder="Provincia destino" /><div className="mt-1 flex items-center gap-2">{fila.localidadPendiente && <span className="text-xs text-amber-700">Original: {fila.localidadPendiente}</span>}<button type="button" className="text-xs text-primary hover:underline" onClick={() => actualizarLocalidad(fila.fila, null, true)}>Sin localidad</button></div></td><td className="p-2">{fila.precioBulto}</td><td className="p-2">{fila.precioPallet}</td></tr>)}</tbody></table></div></div>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => cerrar(false)} disabled={importando}>Cancelar</Button><Button onClick={importar} disabled={leyendo || importando || errores.length > 0 || filas.length === 0 || filasPendientes.length > 0}>{importando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importar {filas.length ? `${filas.length} configuración${filas.length !== 1 ? 'es' : ''}` : 'configuraciones'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
