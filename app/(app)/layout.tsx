import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/layout/AppShell';
import type { PerfilUsuario } from '@/lib/types/database';
import { getCurrentUserProfile } from '@/lib/auth/current-user';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, perfil } = await getCurrentUserProfile();

  if (!user) {
    redirect('/login');
  }

  // Si por alguna razón no tiene perfil (edge case), crearlo
  if (!perfil) {
    const supabase = await createClient();
    await supabase.from('perfiles_usuario').insert({
      id: user.id,
      rol: 'operario',
    });
  }

  const perfilData: PerfilUsuario = perfil ?? {
    id: user.id,
    nombre_completo: null,
    rol: 'operario',
    origen_predeterminado_provincia: null,
    origen_predeterminado_localidad: null,
    destino_predeterminado_provincia: null,
    destino_predeterminado_localidad: null,
    created_at: new Date().toISOString(),
  };

  return <AppShell perfil={perfilData}>{children}</AppShell>;
}
