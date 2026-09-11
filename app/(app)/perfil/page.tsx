import { PerfilClient } from './PerfilClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { redirect } from 'next/navigation';
import { getCurrentUserProfile } from '@/lib/auth/current-user';

export const metadata = { title: 'Mi Perfil — Tarifario' };

export default async function PerfilPage() {
  const { user, perfil } = await getCurrentUserProfile();

  if (!user) redirect('/login');

  return (
    <div>
      <PageHeader
        title="Mi perfil"
        description="Configurá tus datos y la ruta predeterminada para el módulo de Envíos"
      />
      <PerfilClient
        perfil={perfil}
        email={user.email ?? ''}
      />
    </div>
  );
}
