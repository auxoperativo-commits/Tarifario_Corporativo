import { createClient } from '@/lib/supabase/server';
import { EnviosClient } from './EnviosClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { getCurrentUserProfile } from '@/lib/auth/current-user';

export const metadata = { title: 'Envíos — Tarifario' };

export default async function EnviosPage() {
  const supabase = await createClient();

  // Cargamos todo lo necesario para el cálculo en el servidor
  const [{ data: configuraciones }, { data: tags }, { data: sucursales }, { data: caracteristicas }, { perfil }] = await Promise.all([
    supabase
      .from('configuraciones_envio')
      .select(
        `*, transportes(*), tarifas_bulto(*), tarifas_pallet(*), tarifas_kg(*), configuracion_tags(tag_id, tags(*)), configuracion_tag_precios(*), configuracion_caracteristicas(caracteristica_id, caracteristicas_transporte(*))`
      )
      .eq('activo', true),
    supabase.from('tags').select('*').order('nombre'),
    supabase.from('sucursales').select('*').eq('activa', true).order('nombre'),
    supabase.from('caracteristicas_transporte').select('*').order('nombre'),
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
        caracteristicasDisponibles={(caracteristicas ?? []) as import('@/lib/types/database').Caracteristica[]}
        sucursales={sucursales ?? []}
        perfilDefaults={perfil}
      />
    </div>
  );
}
