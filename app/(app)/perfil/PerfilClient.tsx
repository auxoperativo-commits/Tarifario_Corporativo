'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import type { PerfilUsuario, UbicacionSeleccionada } from '@/lib/types/database';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, User, MapPin, Mail, ShieldCheck, X } from 'lucide-react';

const ROL_LABELS: Record<string, string> = {
  operario: 'Operario',
  admin: 'Administrador',
};

const ROL_COLORS: Record<string, string> = {
  operario: 'bg-slate-100 text-slate-700 border-slate-200',
  admin: 'bg-red-100 text-red-700 border-red-200',
};

interface PerfilClientProps {
  perfil: PerfilUsuario | null;
  email: string;
}

export function PerfilClient({ perfil, email }: PerfilClientProps) {
  const { toast } = useToast();
  const supabase = createClient();

  const [nombre, setNombre] = useState(perfil?.nombre_completo ?? '');
  const [origen, setOrigen] = useState<UbicacionSeleccionada | null>(
    perfil?.origen_predeterminado_provincia
      ? {
          provincia: perfil.origen_predeterminado_provincia,
          localidad: perfil.origen_predeterminado_localidad ?? null,
        }
      : null
  );
  const [destino, setDestino] = useState<UbicacionSeleccionada | null>(
    perfil?.destino_predeterminado_provincia
      ? {
          provincia: perfil.destino_predeterminado_provincia,
          localidad: perfil.destino_predeterminado_localidad ?? null,
        }
      : null
  );

  const [savingNombre, setSavingNombre] = useState(false);
  const [savingRuta, setSavingRuta] = useState(false);

  const rol = perfil?.rol ?? 'operario';

  async function guardarNombre() {
    if (!perfil) return;
    setSavingNombre(true);
    const { error } = await supabase
      .from('perfiles_usuario')
      .update({ nombre_completo: nombre.trim() || null })
      .eq('id', perfil.id);
    setSavingNombre(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al guardar el nombre.' });
    } else {
      toast({ title: 'Nombre actualizado correctamente.' });
    }
  }

  async function guardarRuta() {
    if (!perfil) return;
    setSavingRuta(true);
    const { error } = await supabase
      .from('perfiles_usuario')
      .update({
        origen_predeterminado_provincia: origen?.provincia ?? null,
        origen_predeterminado_localidad: origen?.localidad ?? null,
        destino_predeterminado_provincia: destino?.provincia ?? null,
        destino_predeterminado_localidad: destino?.localidad ?? null,
      })
      .eq('id', perfil.id);
    setSavingRuta(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Error al guardar la ruta predeterminada.' });
    } else {
      toast({
        title: 'Ruta predeterminada guardada.',
        description: 'Se precargará automáticamente al entrar al módulo de Envíos.',
      });
    }
  }

  function limpiarRuta() {
    setOrigen(null);
    setDestino(null);
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Datos de cuenta ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-muted-foreground" />
            Datos de cuenta
          </CardTitle>
          <CardDescription>
            Tu información de acceso al sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Email (solo lectura) */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Correo electrónico
            </Label>
            <div className="flex h-10 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground">
              {email}
            </div>
          </div>

          {/* Rol (solo lectura) */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              Rol en el sistema
            </Label>
            <div>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${ROL_COLORS[rol]}`}
              >
                {ROL_LABELS[rol] ?? rol}
              </span>
              <p className="text-xs text-muted-foreground mt-1.5">
                El rol lo asigna el administrador del sistema.
              </p>
            </div>
          </div>

          <Separator />

          {/* Nombre editable */}
          <div className="space-y-1.5">
            <Label htmlFor="nombre-completo">Nombre completo</Label>
            <div className="flex gap-2">
              <Input
                id="nombre-completo"
                placeholder="Juan Pérez"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && guardarNombre()}
              />
              <Button
                onClick={guardarNombre}
                disabled={savingNombre}
                variant="secondary"
              >
                {savingNombre && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Ruta predeterminada ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Ruta predeterminada
          </CardTitle>
          <CardDescription>
            Se precarga automáticamente en el módulo de Envíos cada vez que ingresás.
            Útil si siempre despachás desde la misma sucursal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <GeorefCombobox
            label="Origen predeterminado"
            value={origen}
            onChange={setOrigen}
            placeholder="Seleccionar provincia..."
            localidadOpcional
          />

          <GeorefCombobox
            label="Destino predeterminado"
            value={destino}
            onChange={setDestino}
            placeholder="Seleccionar provincia..."
            localidadOpcional
          />

          {/* Preview de la ruta si hay datos */}
          {(origen || destino) && (
            <div className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2.5 border">
              <span className="text-muted-foreground truncate">
                {origen
                  ? `${origen.provincia}${origen.localidad ? ` · ${origen.localidad}` : ''}`
                  : 'Sin origen'}
              </span>
              <span className="text-muted-foreground shrink-0">→</span>
              <span className="text-muted-foreground truncate">
                {destino
                  ? `${destino.provincia}${destino.localidad ? ` · ${destino.localidad}` : ''}`
                  : 'Sin destino'}
              </span>
              <button
                type="button"
                onClick={limpiarRuta}
                className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                aria-label="Limpiar ruta predeterminada"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={guardarRuta} disabled={savingRuta}>
              {savingRuta && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar ruta predeterminada
            </Button>
            {(origen || destino) && (
              <Button variant="outline" onClick={limpiarRuta}>
                Limpiar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
