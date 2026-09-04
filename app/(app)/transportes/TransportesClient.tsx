'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';
import { puedeEditar } from '@/components/layout/AppShell';
import { useToast } from '@/hooks/use-toast';
import type { Transporte } from '@/lib/types/database';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/layout/EmptyState';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Settings,
  Truck,
  Loader2,
  ExternalLink,
} from 'lucide-react';

interface TransportesClientProps {
  transportesIniciales: Transporte[];
}

const FORM_VACIO: Omit<Transporte, 'id' | 'created_at' | 'updated_at'> = {
  razon_social: '',
  nombre_fantasia: null,
  cuit: null,
  observacion: null,
  activo: true,
};

export function TransportesClient({ transportesIniciales }: TransportesClientProps) {
  const { perfil } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const editar = puedeEditar(perfil.rol);

  const [transportes, setTransportes] = useState<Transporte[]>(transportesIniciales);
  const [busqueda, setBusqueda] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [borradoFisicoId, setBorradoFisicoId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Omit<Transporte, 'id' | 'created_at' | 'updated_at'>>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  // ── Filtrado ──────────────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return transportes;
    const q = busqueda.toLowerCase();
    return transportes.filter(
      (t) =>
        t.razon_social.toLowerCase().includes(q) ||
        (t.nombre_fantasia ?? '').toLowerCase().includes(q) ||
        (t.cuit ?? '').includes(q)
    );
  }, [transportes, busqueda]);

  // ── Formulario ────────────────────────────────────────────────────────────
  function abrirNuevo() {
    setForm(FORM_VACIO);
    setEditandoId(null);
    setDialogOpen(true);
  }

  function abrirEdicion(t: Transporte) {
    setForm({
      razon_social: t.razon_social,
      nombre_fantasia: t.nombre_fantasia,
      cuit: t.cuit,
      observacion: t.observacion,
      activo: t.activo,
    });
    setEditandoId(t.id);
    setDialogOpen(true);
  }

  async function guardar() {
    if (!form.razon_social.trim()) {
      toast({ variant: 'destructive', title: 'La razón social es obligatoria.' });
      return;
    }
    setSaving(true);
    try {
      if (editandoId) {
        const { error } = await supabase
          .from('transportes')
          .update({ ...form, updated_at: new Date().toISOString() })
          .eq('id', editandoId);
        if (error) throw error;
        setTransportes((prev) =>
          prev.map((t) =>
            t.id === editandoId ? { ...t, ...form } : t
          )
        );
        toast({ title: 'Transporte actualizado correctamente.' });
      } else {
        const { data, error } = await supabase
          .from('transportes')
          .insert(form)
          .select()
          .single();
        if (error) throw error;
        setTransportes((prev) => [...prev, data]);
        toast({ title: 'Transporte creado correctamente.' });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: err instanceof Error ? err.message : 'Error inesperado',
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActivo(t: Transporte) {
    const { error } = await supabase
      .from('transportes')
      .update({ activo: !t.activo, updated_at: new Date().toISOString() })
      .eq('id', t.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al cambiar estado.' });
      return;
    }
    setTransportes((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, activo: !x.activo } : x))
    );
  }

  async function bajaLogica(id: string) {
    const { error } = await supabase
      .from('transportes')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al dar de baja.' });
      return;
    }
    setTransportes((prev) =>
      prev.map((x) => (x.id === id ? { ...x, activo: false } : x))
    );
    setEliminandoId(null);
    toast({ title: 'Transporte dado de baja.' });
  }

  async function borradoFisico(id: string) {
    const { error } = await supabase.from('transportes').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al eliminar.', description: error.message });
      return;
    }
    setTransportes((prev) => prev.filter((x) => x.id !== id));
    setBorradoFisicoId(null);
    toast({ title: 'Transporte eliminado permanentemente.' });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por razón social, nombre de fantasía o CUIT..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        {editar && (
          <Button onClick={abrirNuevo} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo transporte
          </Button>
        )}
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No hay transportes"
          description={
            busqueda
              ? 'No se encontraron transportes con esa búsqueda.'
              : 'Agregá el primer transporte para empezar.'
          }
          action={
            editar && !busqueda ? (
              <Button onClick={abrirNuevo}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo transporte
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtrados.map((t) => (
            <div
              key={t.id}
              className="bg-white border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 truncate">
                    {t.razon_social}
                  </span>
                  {t.nombre_fantasia && (
                    <span className="text-sm text-muted-foreground">
                      &ldquo;{t.nombre_fantasia}&rdquo;
                    </span>
                  )}
                  <Badge variant={t.activo ? 'default' : 'secondary'}>
                    {t.activo ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
                {t.cuit && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    CUIT: {t.cuit}
                  </p>
                )}
                {t.observacion && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
                    {t.observacion}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(`/configuraciones?transporte=${t.id}`)
                  }
                >
                  <Settings className="mr-1.5 h-3.5 w-3.5" />
                  Configuraciones
                </Button>

                {editar && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => abrirEdicion(t)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEliminandoId(t.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog Alta/Edición */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editandoId ? 'Editar transporte' : 'Nuevo transporte'}
            </DialogTitle>
            <DialogDescription>
              Completá los datos del transporte. Solo la razón social es obligatoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="razon_social">
                Razón social <span className="text-destructive">*</span>
              </Label>
              <Input
                id="razon_social"
                placeholder="Transporte Ejemplo SRL"
                value={form.razon_social}
                onChange={(e) =>
                  setForm((f) => ({ ...f, razon_social: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nombre_fantasia">Nombre de fantasía</Label>
              <Input
                id="nombre_fantasia"
                placeholder="Ej: TransEjemplo"
                value={form.nombre_fantasia ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    nombre_fantasia: e.target.value || null,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cuit">CUIT</Label>
              <Input
                id="cuit"
                placeholder="30-12345678-9"
                value={form.cuit ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cuit: e.target.value || null }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="observacion">Observación</Label>
              <textarea
                id="observacion"
                rows={3}
                placeholder="Notas adicionales sobre el transporte..."
                value={form.observacion ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    observacion: e.target.value || null,
                  }))
                }
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="activo"
                checked={form.activo}
                onCheckedChange={(v) => setForm((f) => ({ ...f, activo: v }))}
              />
              <Label htmlFor="activo">Activo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editandoId ? 'Guardar cambios' : 'Crear transporte'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alert baja lógica */}
      <AlertDialog
        open={!!eliminandoId}
        onOpenChange={(o) => !o && setEliminandoId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja el transporte?</AlertDialogTitle>
            <AlertDialogDescription>
              El transporte quedará inactivo pero no se eliminará. Sus
              configuraciones y el historial se conservan. También podés
              eliminarlo permanentemente si ya no lo necesitás.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setBorradoFisicoId(eliminandoId);
                setEliminandoId(null);
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Eliminar permanentemente
            </Button>
            <AlertDialogAction onClick={() => bajaLogica(eliminandoId!)}>
              Dar de baja
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Alert borrado físico */}
      <AlertDialog
        open={!!borradoFisicoId}
        onOpenChange={(o) => !o && setBorradoFisicoId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán el transporte y
              todas sus configuraciones de envío asociadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => borradoFisico(borradoFisicoId!)}
            >
              Eliminar permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
