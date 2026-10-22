import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { MovimientosClient } from './MovimientosClient';

export const metadata = { title: 'Movimientos - Tarifario' };

export default async function MovimientosPage() {
  const supabase = await createClient();
  const { data: movimientos } = await supabase.from('movimientos').select('*').order('created_at', { ascending: false }).limit(500);

  return (
    <div>
      <PageHeader title="Movimientos" description="Consultá las acciones realizadas y la evolución de los precios." />
      <MovimientosClient
        movimientosIniciales={movimientos ?? []}
      />
    </div>
  );
}
