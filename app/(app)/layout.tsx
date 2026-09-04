import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/layout/AppShell';
import type { PerfilUsuario } from '@/lib/types/database';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: perfil } = await supabase
    .from('perfiles_usuario')
    .select('*')
    .eq('id', user.id)
    .single();

  // Si por alguna razón no tiene perfil (edge case), crearlo
  if (!perfil) {
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
