import { createClient } from '@/lib/supabase/server';
import { TransportesClient } from './TransportesClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Transportes — Tarifario' };

export default async function TransportesPage() {
  const supabase = await createClient();
  const { data: transportes } = await supabase
    .from('transportes')
    .select('*')
    .order('razon_social');

  return (
    <div>
      <PageHeader
        title="Transportes"
        description="Empresas de transporte registradas en el sistema"
      />
      <TransportesClient transportesIniciales={transportes ?? []} />
    </div>
  );
}
