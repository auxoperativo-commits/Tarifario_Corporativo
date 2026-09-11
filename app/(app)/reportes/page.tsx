import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportesClient } from './ReportesClient';

export const metadata = { title: 'Reportes — Tarifario' };

function construirAgregadosPorProvincia(configuraciones: any[]) {
  const provinciaMap = new Map<string, { name: string; value: number; children: Map<string, number> }>();

  configuraciones.forEach((config) => {
    const provincia = (config.origen_provincia ?? '').trim() || 'Sin provincia';
    const localidad = (config.origen_localidad ?? '').trim();

    if (!provinciaMap.has(provincia)) {
      provinciaMap.set(provincia, { name: provincia, value: 0, children: new Map() });
    }

    const provinciaEntry = provinciaMap.get(provincia)!;
    provinciaEntry.value += 1;

    const nombreLocalidad = localidad || `General ${provincia}`;
    provinciaEntry.children.set(nombreLocalidad, (provinciaEntry.children.get(nombreLocalidad) ?? 0) + 1);
  });

  return Array.from(provinciaMap.values())
    .map((provincia) => ({
      name: provincia.name,
      value: provincia.value,
      children: Array.from(provincia.children.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
}

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

  const provinciaData = construirAgregadosPorProvincia(datos);
  const totalConfiguraciones = datos.length;

  return (
    <div>
      <PageHeader title="Reportes" description="Compará tarifas y concentración de rutas configuradas" />
      <ReportesClient configuraciones={datos} />
    </div>
  );
}
