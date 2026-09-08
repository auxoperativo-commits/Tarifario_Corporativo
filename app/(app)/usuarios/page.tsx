import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/layout/PageHeader';
import { PerfilClient } from '../perfil/PerfilClient';
import { UsuariosClient } from './UsuariosClient';
import type { PerfilUsuario } from '@/lib/types/database';

export const metadata = { title: 'Usuarios — Tarifario' };

export default async function UsuariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: perfil } = await supabase.from('perfiles_usuario').select('*').eq('id', user.id).single();
  const perfilData = perfil as PerfilUsuario | null;

  if (perfilData?.rol !== 'admin') {
    return (
      <div>
        <PageHeader title="Usuarios" description="Configurá tu perfil y ruta predeterminada" />
        <PerfilClient perfil={perfilData} email={user.email ?? ''} />
      </div>
    );
  }

  let usuariosIniciales: {
    id: string;
    email: string;
    nombre_completo: string | null;
    rol: 'operario' | 'admin';
    created_at: string;
  }[] = [];
  let errorAdministracion: string | null = null;
  try {
    const admin = createAdminClient();
    const [{ data: usuarios, error: usuariosError }, { data: perfiles, error: perfilesError }] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from('perfiles_usuario').select('id, nombre_completo, rol, created_at'),
    ]);
    if (usuariosError) throw usuariosError;
    if (perfilesError) throw perfilesError;
  const perfilesPorId = new Map((perfiles ?? []).map((item) => [item.id, item]));
    usuariosIniciales = (usuarios?.users ?? []).map((item) => ({
    id: item.id,
    email: item.email ?? '',
    nombre_completo: perfilesPorId.get(item.id)?.nombre_completo ?? item.user_metadata?.nombre_completo ?? null,
    rol: (perfilesPorId.get(item.id)?.rol ?? 'operario') as 'operario' | 'admin',
    created_at: item.created_at,
  }));
  } catch (error) {
    errorAdministracion = error instanceof Error ? error.message : 'No se pudo cargar la administración de usuarios.';
  }

  return (
    <div>
      <PageHeader title="Usuarios" description="Creá y administrá las cuentas internas del sistema" />
      <UsuariosClient usuariosIniciales={usuariosIniciales} errorAdministracion={errorAdministracion} />
    </div>
  );
}
