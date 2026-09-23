'use client';

import { useState } from 'react';
import { crearUsuario } from '@/app/actions/usuarios';
import { useToast } from '@/hooks/use-toast';
import { GeorefCombobox } from '@/components/georef/GeorefCombobox';
import { createClient } from '@/lib/supabase/client';
import type { Sucursal, UbicacionSeleccionada, GrupoSucursales, GrupoSucursalesMiembros } from '@/lib/types/database';
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

interface GrupoForm {
  nombre: string;
  sucursalIds: string[];
}

const FORMULARIO_SUCURSAL_VACIO: SucursalForm = {
  nombre: '',
  direccion: '',
  origen: null,
};

const FORMULARIO_GRUPO_VACIO: GrupoForm = {
  nombre: '',
  sucursalIds: [],
};

export function UsuariosClient({
  usuariosIniciales,
  sucursalesIniciales,
  gruposIniciales,
  gruposMiembrosIniciales,
  errorAdministracion,
}: {
  usuariosIniciales: UsuarioResumen[];
  sucursalesIniciales: Sucursal[];
  gruposIniciales: GrupoSucursales[];
  gruposMiembrosIniciales: GrupoSucursalesMiembros[];
  errorAdministracion: string | null;
}) {
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
  const [grupos, setGrupos] = useState<GrupoSucursales[]>(gruposIniciales);
  const [gruposMiembros, setGruposMiembros] = useState<GrupoSucursalesMiembros[]>(gruposMiembrosIniciales);
  const [grupoForm, setGrupoForm] = useState<GrupoForm>(FORMULARIO_GRUPO_VACIO);
  const [grupoEditandoId, setGrupoEditandoId] = useState<string | null>(null);
  const [guardandoGrupo, setGuardandoGrupo] = useState(false);

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

  function toggleSucursalEnGrupo(sucursalId: string) {
    setGrupoForm((prev) => {
      const yaExiste = prev.sucursalIds.includes(sucursalId);
      return {
        ...prev,
        sucursalIds: yaExiste
          ? prev.sucursalIds.filter((id) => id !== sucursalId)
          : [...prev.sucursalIds, sucursalId],
      };
    });
  }

  async function guardarGrupo() {
    if (!grupoForm.nombre.trim()) {
      toast({ variant: 'destructive', title: 'Ingresá un nombre para el grupo.' });
      return;
    }

    setGuardandoGrupo(true);
    try {
      const nombre = grupoForm.nombre.trim();
      const sucursalIds = Array.from(new Set(grupoForm.sucursalIds));

      let grupoId = grupoEditandoId;
      let grupoActual: GrupoSucursales | null = null;

      if (grupoEditandoId) {
        const { data, error } = await supabase
          .from('grupos_sucursales')
          .update({ nombre })
          .eq('id', grupoEditandoId)
          .select()
          .single();
        if (error) throw error;
        grupoActual = data;
        grupoId = data.id;
      } else {
        const { data, error } = await supabase
          .from('grupos_sucursales')
          .insert({ nombre })
          .select()
          .single();
        if (error) throw error;
        grupoActual = data;
        grupoId = data.id;
      }

      if (!grupoId) throw new Error('No se pudo identificar el grupo para guardar sus sucursales.');

      await supabase.from('grupo_sucursales_miembros').delete().eq('grupo_id', grupoId);
      if (sucursalIds.length > 0) {
        const rows: GrupoSucursalesMiembros[] = sucursalIds.map((sucursal_id) => ({ grupo_id: grupoId, sucursal_id }));
        const { error: errorMiembros } = await supabase.from('grupo_sucursales_miembros').insert(rows);
        if (errorMiembros) throw errorMiembros;
        setGruposMiembros((prev) => prev.filter((miembro) => miembro.grupo_id !== grupoId).concat(rows));
      } else {
        setGruposMiembros((prev) => prev.filter((miembro) => miembro.grupo_id !== grupoId));
      }

      if (grupoActual) {
        setGrupos((prev) => {
          const existente = prev.some((item) => item.id === grupoActual.id);
          if (existente) return prev.map((item) => (item.id === grupoActual.id ? grupoActual : item));
          return [...prev, grupoActual];
        });
      }

      toast({ title: grupoEditandoId ? 'Grupo actualizado.' : 'Grupo creado.' });
      setGrupoForm(FORMULARIO_GRUPO_VACIO);
      setGrupoEditandoId(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar el grupo.', description: error instanceof Error ? error.message : 'Error inesperado' });
    } finally {
      setGuardandoGrupo(false);
    }
  }

  async function toggleGrupoActiva(grupo: GrupoSucursales) {
    const { data, error } = await supabase
      .from('grupos_sucursales')
      .update({ activo: !grupo.activo })
      .eq('id', grupo.id)
      .select()
      .single();

    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo cambiar el estado del grupo.' });
      return;
    }

    setGrupos((prev) => prev.map((item) => item.id === data.id ? data : item));
    toast({ title: grupo.activo ? 'Grupo dado de baja.' : 'Grupo reactivado.' });
  }

  function editarGrupo(grupo: GrupoSucursales) {
    setGrupoEditandoId(grupo.id);
    const sucursalIds = gruposMiembros.filter((m) => m.grupo_id === grupo.id).map((m) => m.sucursal_id);
    setGrupoForm({ nombre: grupo.nombre, sucursalIds });
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
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" />Grupos de sucursales</CardTitle>
            {grupoEditandoId && (
              <Button variant="outline" size="sm" onClick={() => { setGrupoEditandoId(null); setGrupoForm(FORMULARIO_GRUPO_VACIO); }}>
                Cancelar edición
              </Button>
            )}
          </div>
          <CardDescription>Unificá sucursales del mismo origen físico para reutilizar una sola configuración.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1.3fr_1.7fr]">
            <div className="space-y-1.5">
              <Label htmlFor="grupo-nombre">Nombre del grupo</Label>
              <Input id="grupo-nombre" value={grupoForm.nombre} onChange={(event) => setGrupoForm((prev) => ({ ...prev, nombre: event.target.value }))} placeholder="Ej: Córdoba Centro" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Sucursales del grupo</Label>
              <div className="grid max-h-40 gap-2 overflow-auto rounded-md border bg-slate-50 p-2">
                {sucursales.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay sucursales disponibles.</p>
                ) : (
                  sucursales.map((sucursal) => (
                    <label key={sucursal.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white">
                      <input
                        type="checkbox"
                        checked={grupoForm.sucursalIds.includes(sucursal.id)}
                        onChange={() => toggleSucursalEnGrupo(sucursal.id)}
                      />
                      <span className="text-sm">{sucursal.nombre} · {sucursal.localidad}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={guardarGrupo} disabled={guardandoGrupo}>
              {guardandoGrupo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {grupoEditandoId ? 'Guardar cambios' : 'Crear grupo'}
            </Button>
          </div>

          <div className="space-y-2 pt-2">
            {grupos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay grupos configurados.</p>
            ) : (
              grupos.map((grupo) => {
                const miembros = gruposMiembros.filter((m) => m.grupo_id === grupo.id);
                return (
                  <div key={grupo.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{grupo.nombre}</p>
                        <Badge variant={grupo.activo ? 'default' : 'secondary'}>{grupo.activo ? 'Activo' : 'Inactivo'}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {miembros.length > 0
                          ? `${miembros.length} sucursal${miembros.length > 1 ? 'es' : ''} asociada${miembros.length > 1 ? 's' : ''}`
                          : 'Sin sucursales asociadas'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => editarGrupo(grupo)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />Editar
                      </Button>
                      <Button variant={grupo.activo ? 'secondary' : 'default'} size="sm" onClick={() => toggleGrupoActiva(grupo)}>
                        {grupo.activo ? <PowerOff className="mr-1 h-3.5 w-3.5" /> : <Power className="mr-1 h-3.5 w-3.5" />}
                        {grupo.activo ? 'Dar de baja' : 'Reactivar'}
                      </Button>
                    </div>
                  </div>
                );
              })
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
