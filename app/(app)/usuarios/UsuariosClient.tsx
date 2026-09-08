'use client';

import { useState } from 'react';
import { crearUsuario } from '@/app/actions/usuarios';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, UserPlus, Users } from 'lucide-react';

type UsuarioResumen = {
  id: string;
  email: string;
  nombre_completo: string | null;
  rol: 'operario' | 'admin';
  created_at: string;
};

export function UsuariosClient({ usuariosIniciales, errorAdministracion }: { usuariosIniciales: UsuarioResumen[]; errorAdministracion: string | null }) {
  const { toast } = useToast();
  const [usuarios, setUsuarios] = useState(usuariosIniciales);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<'operario' | 'admin'>('operario');
  const [guardando, setGuardando] = useState(false);

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
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" />Usuarios registrados</CardTitle></CardHeader>
        <CardContent className="space-y-2">{usuarios.map((usuario) => <div key={usuario.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{usuario.nombre_completo || 'Sin nombre'}</p><p className="text-sm text-muted-foreground">{usuario.email}</p></div><Badge variant={usuario.rol === 'admin' ? 'destructive' : 'secondary'}><ShieldCheck className="mr-1 h-3 w-3" />{usuario.rol === 'admin' ? 'Administrador' : 'Operario'}</Badge></div>)}{usuarios.length === 0 && <p className="text-sm text-muted-foreground">No hay usuarios registrados.</p>}</CardContent>
      </Card>
      {errorAdministracion && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{errorAdministracion} Configurá `SUPABASE_SERVICE_ROLE_KEY` en Vercel para habilitar la administración de cuentas.</p>}
    </div>
  );
}
