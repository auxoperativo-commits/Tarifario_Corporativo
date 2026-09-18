import { createClient } from '@/lib/supabase/server';
import { TagsClient } from './TagsClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Tags y Características — Tarifario' };

export default async function TagsPage() {
  const supabase = await createClient();

  const [{ data: tags }, { data: caracteristicas }] = await Promise.all([
    supabase.from('tags').select('*').order('nombre'),
    supabase.from('caracteristicas_transporte').select('*').order('nombre'),
  ]);

  return (
    <div>
      <PageHeader
        title="Tags y Características"
        description="Gestioná las etiquetas con valor económico (Tags) y los atributos cualitativos de transporte (Características)"
      />
      <TagsClient
        tagsIniciales={tags ?? []}
        caracteristicasIniciales={(caracteristicas ?? []) as import('@/lib/types/database').Caracteristica[]}
      />
    </div>
  );
}
