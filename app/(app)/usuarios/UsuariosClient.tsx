'use client';

import { useState } from 'react';
import { crearUsuario } from '@/app/actions/usuarios';
import { useToast } from '@/hooks/use-toast';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import { createClient } from '@/lib/supabase/client';
import type { Sucursal, UbicacionSeleccionada } from '@/lib/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, UserPlus, Users, MapPinned, Pencil, Power, PowerOff } from 'lucide-react';

type UsuarioResumen = {
  id: string;
  email: string;
  nombre_completo: string | null;
  rol: 'operario' | 'admin';
  created_at: string;
};

interface SucursalForm {
  nombre: string;
  direccion: string;
  origen: UbicacionSeleccionada | null;
}

const FORMULARIO_SUCURSAL_VACIO: SucursalForm = {
  nombre: '',
  direccion: '',
  origen: null,
};

export function UsuariosClient({ usuariosIniciales, sucursalesIniciales, errorAdministracion }: { usuariosIniciales: UsuarioResumen[]; sucursalesIniciales: Sucursal[]; errorAdministracion: string | null }) {
  const { toast } = useToast();
  const supabase = createClient();
  const [usuarios, setUsuarios] = useState(usuariosIniciales);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<'operario' | 'admin'>('operario');
  const [guardando, setGuardando] = useState(false);
  const [sucursales, setSucursales] = useState<Sucursal[]>(sucursalesIniciales);
  const [sucursalForm, setSucursalForm] = useState<SucursalForm>(FORMULARIO_SUCURSAL_VACIO);
  const [sucursalEditandoId, setSucursalEditandoId] = useState<string | null>(null);
  const [guardandoSucursal, setGuardandoSucursal] = useState(false);

  async function guardar() {
    setGuardando(true);
    const resultado = await crearUsuario({ email, password, nombre, rol });
    setGuardando(false);
    if (resultado.error) {
      toast({ variant: 'destructive', title: 'No se pudo crear el usuario', description: resultado.error });
      return;
    }
    toast({ title: 'Usuario creado correctamente.' });
    window.location.reload();
  }

  async function guardarSucursal() {
    if (!sucursalForm.nombre.trim()) {
      toast({ variant: 'destructive', title: 'Ingresá un nombre para la sucursal.' });
      return;
    }
    if (!sucursalForm.origen?.provincia || !sucursalForm.origen.localidad) {
      toast({ variant: 'destructive', title: 'Seleccioná provincia y localidad para la sucursal.' });
      return;
    }

    setGuardandoSucursal(true);
    try {
      const payload = {
        nombre: sucursalForm.nombre.trim(),
        provincia: sucursalForm.origen.provincia,
        localidad: sucursalForm.origen.localidad,
        direccion: sucursalForm.direccion.trim() || null,
      };

      if (sucursalEditandoId) {
        const { data, error } = await supabase
          .from('sucursales')
          .update(payload)
          .eq('id', sucursalEditandoId)
          .select()
          .single();
        if (error) throw error;
        setSucursales((prev) => prev.map((item) => item.id === data.id ? data : item));
        toast({ title: 'Sucursal actualizada.' });
      } else {
        const { data, error } = await supabase
          .from('sucursales')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setSucursales((prev) => [...prev, data]);
        toast({ title: 'Sucursal creada.' });
      }

      setSucursalForm(FORMULARIO_SUCURSAL_VACIO);
      setSucursalEditandoId(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar la sucursal.', description: error instanceof Error ? error.message : 'Error inesperado' });
    } finally {
      setGuardandoSucursal(false);
    }
  }

  async function toggleSucursalActiva(sucursal: Sucursal) {
    const { data, error } = await supabase
      .from('sucursales')
      .update({ activa: !sucursal.activa })
      .eq('id', sucursal.id)
      .select()
      .single();

    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo cambiar el estado de la sucursal.' });
      return;
    }

    setSucursales((prev) => prev.map((item) => item.id === data.id ? data : item));
    toast({ title: sucursal.activa ? 'Sucursal dada de baja.' : 'Sucursal reactivada.' });
  }

  function editarSucursal(sucursal: Sucursal) {
    setSucursalEditandoId(sucursal.id);
    setSucursalForm({
      nombre: sucursal.nombre,
      direccion: sucursal.direccion ?? '',
      origen: { provincia: sucursal.provincia, localidad: sucursal.localidad, tipo: 'sucursal', id: sucursal.id, nombre: sucursal.nombre },
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4 text-primary" />Crear usuario</CardTitle>
          <CardDescription>La cuenta queda activa inmediatamente. El correo se confirma automáticamente para uso interno.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="usuario-nombre">Nombre completo</Label><Input id="usuario-nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} placeholder="Nombre del usuario" /></div>
          <div className="space-y-1.5"><Label htmlFor="usuario-email">Correo electrónico</Label><Input id="usuario-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@empresa.com" /></div>
          <div className="space-y-1.5"><Label htmlFor="usuario-password">Contraseña inicial</Label><Input id="usuario-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 6 caracteres" /></div>
          <div className="space-y-1.5"><Label htmlFor="usuario-rol">Rol</Label><select id="usuario-rol" value={rol} onChange={(event) => setRol(event.target.value as 'operario' | 'admin')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="operario">Operario</option><option value="admin">Administrador</option></select></div>
          <div className="sm:col-span-2"><Button onClick={guardar} disabled={guardando}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear usuario</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base"><MapPinned className="h-4 w-4 text-primary" />Sucursales</CardTitle>
            {sucursalEditandoId && (
              <Button variant="outline" size="sm" onClick={() => { setSucursalEditandoId(null); setSucursalForm(FORMULARIO_SUCURSAL_VACIO); }}>
                Cancelar edición
              </Button>
            )}
          </div>
          <CardDescription>Administrá las sucursales que luego podés usar como origen en Configuraciones y Envíos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sucursal-nombre">Nombre</Label>
              <Input id="sucursal-nombre" value={sucursalForm.nombre} onChange={(event) => setSucursalForm((prev) => ({ ...prev, nombre: event.target.value }))} placeholder="Ej: Sucursal Córdoba Norte" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sucursal-direccion">Dirección (opcional)</Label>
              <Input id="sucursal-direccion" value={sucursalForm.direccion} onChange={(event) => setSucursalForm((prev) => ({ ...prev, direccion: event.target.value }))} placeholder="Calle, número, barrio" />
            </div>
          </div>

          <GeorefCombobox
            label="Provincia y localidad"
            value={sucursalForm.origen}
            onChange={(value) => setSucursalForm((prev) => ({ ...prev, origen: value }))}
            placeholder="Seleccionar provincia..."
            localidadOpcional={false}
          />

          <div className="flex gap-2">
            <Button onClick={guardarSucursal} disabled={guardandoSucursal}>
              {guardandoSucursal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sucursalEditandoId ? 'Guardar cambios' : 'Crear sucursal'}
            </Button>
          </div>

          <div className="space-y-2 pt-2">
            {sucursales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay sucursales registradas.</p>
            ) : (
              sucursales.map((sucursal) => (
                <div key={sucursal.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{sucursal.nombre}</p>
                      <Badge variant={sucursal.activa ? 'default' : 'secondary'}>{sucursal.activa ? 'Activa' : 'Inactiva'}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{sucursal.provincia} · {sucursal.localidad}</p>
                    {sucursal.direccion && <p className="text-xs text-muted-foreground">{sucursal.direccion}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => editarSucursal(sucursal)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />Editar
                    </Button>
                    <Button variant={sucursal.activa ? 'secondary' : 'default'} size="sm" onClick={() => toggleSucursalActiva(sucursal)}>
                      {sucursal.activa ? <PowerOff className="mr-1 h-3.5 w-3.5" /> : <Power className="mr-1 h-3.5 w-3.5" />}
                      {sucursal.activa ? 'Dar de baja' : 'Reactivar'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" />Usuarios registrados</CardTitle></CardHeader>
        <CardContent className="space-y-2">{usuarios.map((usuario) => <div key={usuario.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{usuario.nombre_completo || 'Sin nombre'}</p><p className="text-sm text-muted-foreground">{usuario.email}</p></div><Badge variant={usuario.rol === 'admin' ? 'destructive' : 'secondary'}><ShieldCheck className="mr-1 h-3 w-3" />{usuario.rol === 'admin' ? 'Administrador' : 'Operario'}</Badge></div>)}{usuarios.length === 0 && <p className="text-sm text-muted-foreground">No hay usuarios registrados.</p>}</CardContent>
      </Card>
      {errorAdministracion && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{errorAdministracion} Configurá `SUPABASE_SERVICE_ROLE_KEY` en Vercel para habilitar la administración de cuentas.</p>}
    </div>
  );
}
