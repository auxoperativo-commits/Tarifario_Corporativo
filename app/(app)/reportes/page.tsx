import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportesClient } from './ReportesClient';

export const metadata = { title: 'Reportes — Tarifario' };

export default async function ReportesPage() {
  const supabase = await createClient();
  const { data: configuraciones } = await supabase
    .from('configuraciones_envio')
    .select('id, origen_provincia, origen_localidad, destino_provincia, destino_localidad, precio_camion_completo, transportes(id, razon_social, nombre_fantasia), tarifas_bulto(desde_bulto, precio), tarifas_pallet(desde_pallet, precio)')
    .eq('activo', true);

  const datos = (configuraciones ?? []).map((config) => ({
    ...config,
    transportes: Array.isArray(config.transportes) ? config.transportes[0] ?? null : config.transportes,
  }));

  return (
    <div>
      <PageHeader title="Reportes" description="Compará tarifas y concentración de rutas configuradas" />
      <ReportesClient configuraciones={datos} />
    </div>
  );
}
