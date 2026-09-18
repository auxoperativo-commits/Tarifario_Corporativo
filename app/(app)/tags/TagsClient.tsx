'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';
import { puedeEditar } from '@/components/layout/AppShell';
import { useToast } from '@/hooks/use-toast';
import type { Tag, Caracteristica } from '@/lib/types/database';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/layout/EmptyState';
import { Plus, Pencil, Trash2, Tags, Loader2, Shapes } from 'lucide-react';

// ─── Colores preset ────────────────────────────────────────────────────────────

const COLORES_PRESET = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280', '#0f172a',
];

// ─── Props ─────────────────────────────────────────────────────────────────────

interface TagsClientProps {
  tagsIniciales: Tag[];
  caracteristicasIniciales: Caracteristica[];
}

// ─── Sub-componente: selector de color (reutilizable) ─────────────────────────

function ColorPicker({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-wrap gap-2">
        {COLORES_PRESET.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
              color === c ? 'ring-2 ring-offset-2 ring-slate-700 scale-110' : ''
            }`}
            style={{ backgroundColor: c }}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
          />
        ))}
      </div>
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 rounded cursor-pointer border border-input"
        aria-label="Color personalizado"
      />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function TagsClient({ tagsIniciales, caracteristicasIniciales }: TagsClientProps) {
  const { perfil } = useUser();
  const { toast } = useToast();
  const supabase = createClient();
  const editar = puedeEditar(perfil.rol);

  // ── Estado: Tags ───────────────────────────────────────────────────────────
  const [tags, setTags] = useState<Tag[]>(tagsIniciales);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagEliminandoId, setTagEliminandoId] = useState<string | null>(null);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagEditandoId, setTagEditandoId] = useState<string | null>(null);
  const [tagNombre, setTagNombre] = useState('');
  const [tagColor, setTagColor] = useState('#6b7280');

  // ── Estado: Características ────────────────────────────────────────────────
  const [caracteristicas, setCaracteristicas] = useState<Caracteristica[]>(caracteristicasIniciales);
  const [caracDialogOpen, setCaracDialogOpen] = useState(false);
  const [caracEliminandoId, setCaracEliminandoId] = useState<string | null>(null);
  const [caracSaving, setCaracSaving] = useState(false);
  const [caracEditandoId, setCaracEditandoId] = useState<string | null>(null);
  const [caracNombre, setCaracNombre] = useState('');
  const [caracColor, setCaracColor] = useState('#6b7280');

  // ── Handlers: Tags ─────────────────────────────────────────────────────────

  function abrirNuevoTag() {
    setTagNombre(''); setTagColor('#6b7280'); setTagEditandoId(null); setTagDialogOpen(true);
  }

  function abrirEdicionTag(t: Tag) {
    setTagNombre(t.nombre); setTagColor(t.color); setTagEditandoId(t.id); setTagDialogOpen(true);
  }

  async function guardarTag() {
    if (!tagNombre.trim()) {
      toast({ variant: 'destructive', title: 'El nombre es obligatorio.' });
      return;
    }
    setTagSaving(true);
    try {
      if (tagEditandoId) {
        const { error } = await supabase.from('tags')
          .update({ nombre: tagNombre.trim(), color: tagColor })
          .eq('id', tagEditandoId);
        if (error) throw error;
        setTags((prev) =>
          prev.map((t) => t.id === tagEditandoId ? { ...t, nombre: tagNombre.trim(), color: tagColor } : t)
        );
        toast({ title: 'Tag actualizada.' });
      } else {
        const { data, error } = await supabase.from('tags')
          .insert({ nombre: tagNombre.trim(), color: tagColor })
          .select().single();
        if (error) throw error;
        setTags((prev) => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
        toast({ title: 'Tag creada.' });
      }
      setTagDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: msg.includes('unique') ? 'Ya existe una tag con ese nombre.' : msg,
      });
    } finally {
      setTagSaving(false);
    }
  }

  async function eliminarTag(id: string) {
    const { error } = await supabase.from('tags').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al eliminar.', description: error.message });
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
    setTagEliminandoId(null);
    toast({ title: 'Tag eliminada.' });
  }

  // ── Handlers: Características ──────────────────────────────────────────────

  function abrirNuevaCarac() {
    setCaracNombre(''); setCaracColor('#6b7280'); setCaracEditandoId(null); setCaracDialogOpen(true);
  }

  function abrirEdicionCarac(c: Caracteristica) {
    setCaracNombre(c.nombre); setCaracColor(c.color); setCaracEditandoId(c.id); setCaracDialogOpen(true);
  }

  async function guardarCarac() {
    if (!caracNombre.trim()) {
      toast({ variant: 'destructive', title: 'El nombre es obligatorio.' });
      return;
    }
    setCaracSaving(true);
    try {
      if (caracEditandoId) {
        const { error } = await supabase.from('caracteristicas_transporte')
          .update({ nombre: caracNombre.trim(), color: caracColor })
          .eq('id', caracEditandoId);
        if (error) throw error;
        setCaracteristicas((prev) =>
          prev.map((c) => c.id === caracEditandoId ? { ...c, nombre: caracNombre.trim(), color: caracColor } : c)
        );
        toast({ title: 'Característica actualizada.' });
      } else {
        const { data, error } = await supabase.from('caracteristicas_transporte')
          .insert({ nombre: caracNombre.trim(), color: caracColor })
          .select().single();
        if (error) throw error;
        setCaracteristicas((prev) =>
          [...prev, data as Caracteristica].sort((a, b) => a.nombre.localeCompare(b.nombre))
        );
        toast({ title: 'Característica creada.' });
      }
      setCaracDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: msg.includes('unique') ? 'Ya existe una característica con ese nombre.' : msg,
      });
    } finally {
      setCaracSaving(false);
    }
  }

  async function eliminarCarac(id: string) {
    const { error } = await supabase.from('caracteristicas_transporte').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al eliminar.', description: error.message });
      return;
    }
    setCaracteristicas((prev) => prev.filter((c) => c.id !== id));
    setCaracEliminandoId(null);
    toast({ title: 'Característica eliminada.' });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          SECCIÓN 1 — TAGS (con valor económico)
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Tags className="h-4 w-4 text-primary" />
              Tags
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Atributos con valor económico que suman costo adicional a la cotización (ej: Cadena de frío).
            </p>
          </div>
          {editar && (
            <Button size="sm" onClick={abrirNuevoTag}>
              <Plus className="mr-2 h-4 w-4" />Nueva tag
            </Button>
          )}
        </div>

        {tags.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No hay tags"
            description="Creá tags para atributos que suman un costo adicional a la cotización."
            action={editar ? (
              <Button onClick={abrirNuevoTag}><Plus className="mr-2 h-4 w-4" />Nueva tag</Button>
            ) : undefined}
          />
        ) : (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2 bg-white border rounded-full px-4 py-2 shadow-sm">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                <span className="text-sm font-medium text-slate-700">{tag.nombre}</span>
                {editar && (
                  <div className="flex items-center gap-1 ml-1">
                    <button
                      onClick={() => abrirEdicionTag(tag)}
                      className="rounded p-0.5 text-muted-foreground hover:text-slate-800 hover:bg-slate-100 transition-colors"
                      aria-label={`Editar tag ${tag.nombre}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setTagEliminandoId(tag.id)}
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                      aria-label={`Eliminar tag ${tag.nombre}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8" />

      {/* ═══════════════════════════════════════════════════════════════════
          SECCIÓN 2 — CARACTERÍSTICAS DE TRANSPORTE (sin valor económico)
      ═══════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Shapes className="h-4 w-4 text-teal-600" />
              Características de Transporte
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Atributos cualitativos sin costo (ej: Rápido, Limpio, Apto a granel). Solo sirven para filtrar y mostrar — no afectan precios.
            </p>
          </div>
          {editar && (
            <Button size="sm" variant="outline" onClick={abrirNuevaCarac}>
              <Plus className="mr-2 h-4 w-4" />Nueva característica
            </Button>
          )}
        </div>

        {caracteristicas.length === 0 ? (
          <EmptyState
            icon={Shapes}
            title="No hay características"
            description="Creá características para describir atributos cualitativos de los transportes (sin costo asociado)."
            action={editar ? (
              <Button variant="outline" onClick={abrirNuevaCarac}>
                <Plus className="mr-2 h-4 w-4" />Nueva característica
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="flex flex-wrap gap-3">
            {caracteristicas.map((carac) => (
              <div
                key={carac.id}
                className="flex items-center gap-2 bg-white border-2 rounded-full px-4 py-2 shadow-sm"
                style={{ borderColor: carac.color }}
              >
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: carac.color }} aria-hidden="true" />
                <span className="text-sm font-medium" style={{ color: carac.color }}>{carac.nombre}</span>
                {editar && (
                  <div className="flex items-center gap-1 ml-1">
                    <button
                      onClick={() => abrirEdicionCarac(carac)}
                      className="rounded p-0.5 text-muted-foreground hover:text-slate-800 hover:bg-slate-100 transition-colors"
                      aria-label={`Editar característica ${carac.nombre}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setCaracEliminandoId(carac.id)}
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                      aria-label={`Eliminar característica ${carac.nombre}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Dialog alta/edición Tag ──────────────────────────────────────────── */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tagEditandoId ? 'Editar tag' : 'Nueva tag'}</DialogTitle>
            <DialogDescription>
              Las tags se usan para filtrar y agregar costos adicionales en el módulo de Envíos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tag-nombre">Nombre <span className="text-destructive">*</span></Label>
              <Input
                id="tag-nombre"
                placeholder="Ej: Cadena de frío"
                value={tagNombre}
                onChange={(e) => setTagNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && guardarTag()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <ColorPicker color={tagColor} onChange={setTagColor} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Vista previa:</span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: tagColor }}
              >
                {tagNombre || 'Tag'}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagDialogOpen(false)} disabled={tagSaving}>
              Cancelar
            </Button>
            <Button onClick={guardarTag} disabled={tagSaving}>
              {tagSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tagEditandoId ? 'Guardar' : 'Crear tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog eliminar Tag ─────────────────────────────────────────── */}
      <AlertDialog open={!!tagEliminandoId} onOpenChange={(o) => !o && setTagEliminandoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tag?</AlertDialogTitle>
            <AlertDialogDescription>
              Se desvinculará de todas las configuraciones que la usen. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => eliminarTag(tagEliminandoId!)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Dialog alta/edición Característica ──────────────────────────────── */}
      <Dialog open={caracDialogOpen} onOpenChange={setCaracDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{caracEditandoId ? 'Editar característica' : 'Nueva característica'}</DialogTitle>
            <DialogDescription>
              Las características son atributos cualitativos sin costo (ej: Rápido, Limpio). No afectan el precio, solo sirven para filtrar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="carac-nombre">Nombre <span className="text-destructive">*</span></Label>
              <Input
                id="carac-nombre"
                placeholder="Ej: Servicio rápido"
                value={caracNombre}
                onChange={(e) => setCaracNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && guardarCarac()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <ColorPicker color={caracColor} onChange={setCaracColor} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Vista previa:</span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold"
                style={{ borderColor: caracColor, color: caracColor }}
              >
                {caracNombre || 'Característica'}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCaracDialogOpen(false)} disabled={caracSaving}>
              Cancelar
            </Button>
            <Button onClick={guardarCarac} disabled={caracSaving}>
              {caracSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {caracEditandoId ? 'Guardar' : 'Crear característica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog eliminar Característica ─────────────────────────────── */}
      <AlertDialog open={!!caracEliminandoId} onOpenChange={(o) => !o && setCaracEliminandoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar característica?</AlertDialogTitle>
            <AlertDialogDescription>
              Se desvinculará de todas las configuraciones que la usen. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => eliminarCarac(caracEliminandoId!)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
