'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';
import { useToast } from '@/hooks/use-toast';
import type { Contenedor, ContenedorCotizacion } from '@/lib/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { BriefcaseBusiness, Plus, Trash2, Loader2, Package, Truck, MapPinned } from 'lucide-react';

interface Props {
  contenedoresIniciales: Contenedor[];
  cotizacionesIniciales: ContenedorCotizacion[];
}

export function ContenedorClient({ contenedoresIniciales, cotizacionesIniciales }: Props) {
  const { perfil } = useUser();
  const { toast } = useToast();
  const supabase = createClient();

  const [contenedores, setContenedores] = useState<Contenedor[]>(contenedoresIniciales);
  const [cotizaciones, setCotizaciones] = useState<ContenedorCotizacion[]>(cotizacionesIniciales);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [descripcionNuevo, setDescripcionNuevo] = useState('');
  const [creando, setCreando] = useState(false);
  const [eligeContenedorId, setEligeContenedorId] = useState<string>('');

  useEffect(() => {
    async function cargarTodo() {
      try {
        const { data: contenedoresData } = await supabase
          .from('contenedores')
          .select('*')
          .eq('usuario_id', perfil.id)
          .order('created_at', { ascending: false });

        const { data: cotizacionesData } = await supabase
          .from('contenedor_cotizaciones')
          .select('*');

        const contenedorIds = new Set((contenedoresData ?? []).map((item) => item.id));
        setContenedores((contenedoresData ?? []) as Contenedor[]);
        setCotizaciones(((cotizacionesData ?? []) as ContenedorCotizacion[]).filter((item) => contenedorIds.has(item.contenedor_id)));
      } catch {
        setContenedores([]);
        setCotizaciones([]);
      }
    }

    cargarTodo();
  }, [perfil.id, supabase]);

  const resumen = useMemo(() => {
    const porContenedor = contenedores.map((contenedor) => {
      const items = cotizaciones.filter((item) => item.contenedor_id === contenedor.id);
      return {
        contenedor,
        cantidadCotizaciones: items.length,
        total: items.reduce((sum, item) => sum + (Number(item.precio_total) || 0), 0),
        destinos: Array.from(new Set(items.map((item) => item.destino_provincia).filter(Boolean))),
      };
    });

    const totalGeneral = porContenedor.reduce((sum, item) => sum + item.total, 0);
    return { porContenedor, totalGeneral, cantidadTotal: cotizaciones.length };
  }, [contenedores, cotizaciones]);

  async function crearContenedor() {
    if (!nombreNuevo.trim()) {
      toast({ variant: 'destructive', title: 'Ingresá un nombre para el contenedor.' });
      return;
    }

    setCreando(true);
    try {
      const { data, error } = await supabase.from('contenedores').insert({
        usuario_id: perfil.id,
        nombre: nombreNuevo.trim(),
        descripcion: descripcionNuevo.trim() || null,
      }).select().single();

      if (error) throw error;
      setContenedores((prev) => [data as Contenedor, ...prev]);
      setNombreNuevo('');
      setDescripcionNuevo('');
      setEligeContenedorId(data.id);
      toast({ title: 'Contenedor creado.' });
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo crear el contenedor.' });
    } finally {
      setCreando(false);
    }
  }

  async function eliminarCotizacion(cotizacionId: string) {
    const { error } = await supabase.from('contenedor_cotizaciones').delete().eq('id', cotizacionId);
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo eliminar la cotización.' });
      return;
    }
    setCotizaciones((prev) => prev.filter((item) => item.id !== cotizacionId));
    toast({ title: 'Cotización eliminada.' });
  }

  async function eliminarContenedor(contenedorId: string) {
    const { error } = await supabase.from('contenedores').delete().eq('id', contenedorId);
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo eliminar el contenedor.' });
      return;
    }
    setContenedores((prev) => prev.filter((item) => item.id !== contenedorId));
    setCotizaciones((prev) => prev.filter((item) => item.contenedor_id !== contenedorId));
    setEligeContenedorId((prev) => (prev === contenedorId ? '' : prev));
    toast({ title: 'Contenedor eliminado.' });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <BriefcaseBusiness className="h-4 w-4 text-primary" />
          Crear contenedor
        </div>
        <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nombre</Label>
            <Input value={nombreNuevo} onChange={(event) => setNombreNuevo(event.target.value)} placeholder="Ej: Envío a Hospital Córdoba 11/9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Descripción</Label>
            <Input value={descripcionNuevo} onChange={(event) => setDescripcionNuevo(event.target.value)} placeholder="Opcional" />
          </div>
          <div className="flex items-end">
            <Button onClick={crearContenedor} disabled={creando} className="w-full">
              {creando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Crear
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
        <div className="bg-white border rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-800">Resumen</h3>
            <span className="text-sm text-muted-foreground">{resumen.cantidadTotal} cotizaciones</span>
          </div>
          {resumen.porContenedor.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no creaste contenedores.</p>
          ) : (
            <div className="space-y-3">
              {resumen.porContenedor.map(({ contenedor, cantidadCotizaciones, total, destinos }) => (
                <div key={contenedor.id} className="rounded-lg border bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-800">{contenedor.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{cantidadCotizaciones} ítems</span>
                      <Button variant="ghost" size="sm" onClick={() => eliminarContenedor(contenedor.id)} className="h-7 px-2 text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-slate-600">Total acumulado: <span className="font-semibold text-slate-900">${Number(total).toLocaleString('es-AR')}</span></div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {cotizaciones.filter((item) => item.contenedor_id === contenedor.id).map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded bg-white px-2 py-1">
                        <span className="truncate">{item.transporte_nombre ?? 'Transporte'} · {item.destino_provincia}{item.destino_localidad ? ` · ${item.destino_localidad}` : ''}</span>
                        <span className="font-medium text-slate-700">${Number(item.precio_total || 0).toLocaleString('es-AR')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">Destinos: {destinos.length > 0 ? destinos.join(', ') : 'Sin destinos'}</div>
                </div>
              ))}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-semibold text-primary">
                Total general: ${Number(resumen.totalGeneral).toLocaleString('es-AR')}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-800">Cotizaciones guardadas</h3>
            <select value={eligeContenedorId} onChange={(event) => setEligeContenedorId(event.target.value)} className="h-9 rounded-md border px-2 text-sm">
              <option value="">Todos</option>
              {contenedores.map((contenedor) => (
                <option key={contenedor.id} value={contenedor.id}>{contenedor.nombre}</option>
              ))}
            </select>
          </div>

          {cotizaciones.filter((item) => !eligeContenedorId || item.contenedor_id === eligeContenedorId).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no agregaste cotizaciones a ningún contenedor.</p>
          ) : (
            <div className="space-y-3">
              {cotizaciones.filter((item) => !eligeContenedorId || item.contenedor_id === eligeContenedorId).map((item) => {
                const contenedor = contenedores.find((c) => c.id === item.contenedor_id);
                return (
                  <div key={item.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-800">{contenedor?.nombre ?? 'Contenedor'}</div>
                        <div className="text-xs text-muted-foreground">{item.transporte_nombre ?? 'Transporte'}</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => eliminarCotizacion(item.id)} className="text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 text-sm text-slate-600">
                      <div className="flex items-center gap-2"><MapPinned className="h-3.5 w-3.5 text-muted-foreground" />{item.origen_provincia}{item.origen_localidad ? ` · ${item.origen_localidad}` : ''}</div>
                      <div className="flex items-center gap-2"><MapPinned className="h-3.5 w-3.5 text-muted-foreground" />{item.destino_provincia}{item.destino_localidad ? ` · ${item.destino_localidad}` : ''}</div>
                      <div className="flex items-center gap-2"><Package className="h-3.5 w-3.5 text-muted-foreground" />{item.cantidad_bultos || 0} bultos · {item.cantidad_pallets || 0} pallets</div>
                      <div className="flex items-center gap-2"><Truck className="h-3.5 w-3.5 text-muted-foreground" />{item.cantidad_kg || 0} kg</div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t pt-2">
                      <span className="text-xs text-muted-foreground">Precio</span>
                      <span className="text-lg font-bold text-slate-900">${Number(item.precio_total || 0).toLocaleString('es-AR')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
