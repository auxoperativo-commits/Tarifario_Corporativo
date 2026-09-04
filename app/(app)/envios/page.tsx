import { createClient } from '@/lib/supabase/server';
import { EnviosClient } from './EnviosClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Envíos — Tarifario' };

export default async function EnviosPage() {
  const supabase = await createClient();

  // Cargamos todo lo necesario para el cálculo en el servidor
  const [
    { data: configuraciones },
    { data: tags },
    { data: perfil },
    { data: { user } },
  ] = await Promise.all([
    supabase
      .from('configuraciones_envio')
      .select(
        `*, transportes(*), tarifas_bulto(*), tarifas_pallet(*), configuracion_tags(tag_id, tags(*))`
      )
      .eq('activo', true),
    supabase.from('tags').select('*').order('nombre'),
    supabase
      .from('perfiles_usuario')
      .select(
        'origen_predeterminado_provincia, origen_predeterminado_localidad, destino_predeterminado_provincia, destino_predeterminado_localidad'
      )
      .single(),
    supabase.auth.getUser(),
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
        userId={user?.id ?? null}
      />
    </div>
  );
}
