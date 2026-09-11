import { createClient } from '@/lib/supabase/server';
import { ContenedorClient } from './ContenedorClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { getCurrentUserProfile } from '@/lib/auth/current-user';

export const metadata = { title: 'Contenedor — Tarifario' };

export default async function ContenedorPage() {
  const supabase = await createClient();
  const { user } = await getCurrentUserProfile();

  if (!user) {
    return null;
  }

  const { data: contenedores } = await supabase
    .from('contenedores')
    .select('*')
    .eq('usuario_id', user.id)
    .order('created_at', { ascending: false });

  const contenedorIds = (contenedores ?? []).map((item) => item.id);
  const { data: cotizaciones } = contenedorIds.length
    ? await supabase
        .from('contenedor_cotizaciones')
        .select('*')
        .in('contenedor_id', contenedorIds)
    : { data: [] };

  return (
    <div>
      <PageHeader
        title="Contenedor"
        description="Guardá cotizaciones por usuario y armá un resumen final por envío"
      />
      <ContenedorClient contenedoresIniciales={contenedores ?? []} cotizacionesIniciales={cotizaciones ?? []} />
    </div>
  );
}
