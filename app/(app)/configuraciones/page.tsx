import { createClient } from '@/lib/supabase/server';
import { ConfiguracionesClient } from './ConfiguracionesClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Configuraciones de Envío — Tarifario' };

export default async function ConfiguracionesPage({
  searchParams,
}: {
  searchParams: Promise<{ transporte?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: todosLosTransportes }, { data: tags }] = await Promise.all([
    supabase.from('transportes').select('*').order('razon_social'),
    supabase.from('tags').select('*').order('nombre'),
  ]);
  const transportes = (todosLosTransportes ?? []).filter((transporte) => transporte.activo);

  // Si viene preseleccionado un transporte desde la página de Transportes, cargamos sus configs
  let configuracionesIniciales: unknown[] = [];
  if (params.transporte) {
    const { data } = await supabase
      .from('configuraciones_envio')
      .select(`*, tarifas_bulto(*), tarifas_pallet(*), tarifas_kg(*), configuracion_tags(tag_id)`)
      .eq('transporte_id', params.transporte)
      .order('created_at', { ascending: false });
    configuracionesIniciales = data ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Configuraciones de Envío"
        description="Definí las rutas, tarifas y tiempos de entrega por transporte"
      />
      <ConfiguracionesClient
        transportes={transportes}
        transportesParaImportar={todosLosTransportes ?? []}
        tagsIniciales={tags ?? []}
        transportePreseleccionadoId={params.transporte ?? null}
        configuracionesIniciales={configuracionesIniciales}
      />
    </div>
  );
}
