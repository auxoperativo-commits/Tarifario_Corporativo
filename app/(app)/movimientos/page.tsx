import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { MovimientosClient } from './MovimientosClient';

export const metadata = { title: 'Movimientos - Tarifario' };

export default async function MovimientosPage() {
  const supabase = await createClient();
  const [{ data: movimientos }, { data: historialPrecios }, { data: transportes }] = await Promise.all([
    supabase.from('movimientos').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('historial_precios').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('transportes').select('id, razon_social, nombre_fantasia').order('razon_social'),
  ]);

  return (
    <div>
      <PageHeader title="Movimientos" description="Consultá las acciones realizadas y la evolución de los precios por configuración." />
      <MovimientosClient
        movimientosIniciales={movimientos ?? []}
        historialPreciosInicial={historialPrecios ?? []}
        transportes={transportes ?? []}
      />
    </div>
  );
}
