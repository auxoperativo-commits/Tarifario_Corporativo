import { createClient } from '@/lib/supabase/server';
import { TagsClient } from './TagsClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Tags — Tarifario' };

export default async function TagsPage() {
  const supabase = await createClient();
  const { data: tags } = await supabase
    .from('tags')
    .select('*')
    .order('nombre');

  return (
    <div>
      <PageHeader
        title="Tags"
        description="Etiquetas para categorizar y filtrar configuraciones de envío"
      />
      <TagsClient tagsIniciales={tags ?? []} />
    </div>
  );
}
