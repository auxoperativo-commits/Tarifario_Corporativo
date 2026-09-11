import { createClient } from '@/lib/supabase/server';
import { EnviosClient } from './EnviosClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { getCurrentUserProfile } from '@/lib/auth/current-user';

export const metadata = { title: 'Envíos — Tarifario' };

export default async function EnviosPage() {
  const supabase = await createClient();

  // Cargamos todo lo necesario para el cálculo en el servidor
  const [{ data: configuraciones }, { data: tags }, { perfil }] = await Promise.all([
    supabase
      .from('configuraciones_envio')
      .select(
        `*, transportes(*), tarifas_bulto(*), tarifas_pallet(*), tarifas_kg(*), configuracion_tags(tag_id, tags(*)), configuracion_tag_precios(*)`
      )
      .eq('activo', true),
    supabase.from('tags').select('*').order('nombre'),
    getCurrentUserProfile(),
  ]);

  return (
    <div>
      <PageHeader
        title="Cotizar envío"
        description="Compará todas las opciones de transporte disponibles para tu ruta"
      />
      <EnviosClient
        configuracionesRaw={configuraciones ?? []}
        tagsDisponibles={tags ?? []}
        perfilDefaults={perfil}
      />
    </div>
  );
}
