'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';
import { puedeEditar } from '@/components/layout/AppShell';
import { useToast } from '@/hooks/use-toast';
import type { Tag } from '@/lib/types/database';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Plus, Pencil, Trash2, Tags, Loader2 } from 'lucide-react';

// Paleta de colores predefinidos para elegir rápido
const COLORES_PRESET = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280', '#0f172a',
];

interface TagsClientProps {
  tagsIniciales: Tag[];
}

export function TagsClient({ tagsIniciales }: TagsClientProps) {
  const { perfil } = useUser();
  const { toast } = useToast();
  const supabase = createClient();
  const editar = puedeEditar(perfil.rol);

  const [tags, setTags] = useState<Tag[]>(tagsIniciales);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('#6b7280');

  function abrirNuevo() {
    setNombre('');
    setColor('#6b7280');
    setEditandoId(null);
    setDialogOpen(true);
  }

  function abrirEdicion(t: Tag) {
    setNombre(t.nombre);
    setColor(t.color);
    setEditandoId(t.id);
    setDialogOpen(true);
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast({ variant: 'destructive', title: 'El nombre es obligatorio.' });
      return;
    }
    setSaving(true);
    try {
      if (editandoId) {
        const { error } = await supabase
          .from('tags')
          .update({ nombre: nombre.trim(), color })
          .eq('id', editandoId);
        if (error) throw error;
        setTags((prev) =>
          prev.map((t) =>
            t.id === editandoId ? { ...t, nombre: nombre.trim(), color } : t
          )
        );
        toast({ title: 'Tag actualizada.' });
      } else {
        const { data, error } = await supabase
          .from('tags')
          .insert({ nombre: nombre.trim(), color })
          .select()
          .single();
        if (error) throw error;
        setTags((prev) => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
        toast({ title: 'Tag creada.' });
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: msg.includes('unique') ? 'Ya existe una tag con ese nombre.' : msg,
      });
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(id: string) {
    const { error } = await supabase.from('tags').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al eliminar.', description: error.message });
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
    setEliminandoId(null);
    toast({ title: 'Tag eliminada.' });
  }

  return (
    <>
      {editar && (
        <div className="mb-6">
          <Button onClick={abrirNuevo}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva tag
          </Button>
        </div>
      )}

      {tags.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No hay tags"
          description="Creá tags para filtrar y categorizar las configuraciones de envío."
          action={
            editar ? (
              <Button onClick={abrirNuevo}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva tag
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-2 bg-white border rounded-full px-4 py-2 shadow-sm"
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-slate-700">
                {tag.nombre}
              </span>
              {editar && (
                <div className="flex items-center gap-1 ml-1">
                  <button
                    onClick={() => abrirEdicion(tag)}
                    className="rounded p-0.5 text-muted-foreground hover:text-slate-800 hover:bg-slate-100 transition-colors"
                    aria-label={`Editar tag ${tag.nombre}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEliminandoId(tag.id)}
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

      {/* Dialog alta/edición */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editandoId ? 'Editar tag' : 'Nueva tag'}</DialogTitle>
            <DialogDescription>
              Las tags se usan para filtrar resultados en el módulo de Envíos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tag-nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tag-nombre"
                placeholder="Ej: Urgente"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && guardar()}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex items-center gap-3">
                <div className="flex flex-wrap gap-2">
                  {COLORES_PRESET.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
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
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-8 rounded cursor-pointer border border-input"
                  aria-label="Color personalizado"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Vista previa:</span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {nombre || 'Tag'}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editandoId ? 'Guardar' : 'Crear tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alert eliminar */}
      <AlertDialog open={!!eliminandoId} onOpenChange={(o) => !o && setEliminandoId(null)}>
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
              onClick={() => eliminar(eliminandoId!)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
