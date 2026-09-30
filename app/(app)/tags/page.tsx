import { createClient } from '@/lib/supabase/server';
import { TagsClient } from './TagsClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Tags, Servicios y Características — Tarifario' };

export default async function TagsPage() {
  const supabase = await createClient();

  const [{ data: tags }, { data: caracteristicas }, { data: servicios }] = await Promise.all([
    supabase.from('tags').select('*').order('nombre'),
    supabase.from('caracteristicas_transporte').select('*').order('nombre'),
    supabase.from('servicios_transporte').select('*').order('nombre'),
  ]);

  return (
    <div>
      <PageHeader
        title="Tags y Servicios"
        description="Gestioná las etiquetas con valor económico, los servicios fijos por configuración y los atributos cualitativos de transporte"
      />
      <TagsClient
        tagsIniciales={tags ?? []}
        caracteristicasIniciales={(caracteristicas ?? []) as import('@/lib/types/database').Caracteristica[]}
        serviciosIniciales={(servicios ?? []) as import('@/lib/types/database').ServicioTransporte[]}
      />
    </div>
  );
}
