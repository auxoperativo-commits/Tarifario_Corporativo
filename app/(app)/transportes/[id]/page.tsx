import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { TransportesPerfilClient } from './TransportesPerfilClient';

export const metadata = { title: 'Perfil del transporte — Tarifario' };

export default async function TransportePerfilPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const [{ data: transporte }, { data: configuraciones }] = await Promise.all([
    supabase.from('transportes').select('*').eq('id', params.id).single(),
    supabase.from('configuraciones_envio').select('id, origen_provincia, origen_localidad, origen_nombre_personalizado, destino_provincia, destino_localidad, destino_nombre_personalizado, activo').eq('transporte_id', params.id).order('destino_provincia'),
  ]);

  if (!transporte) notFound();

  return (
    <div>
      <PageHeader title={transporte.nombre_fantasia || transporte.razon_social} description={transporte.nombre_fantasia ? transporte.razon_social : 'Perfil del transporte'} />
      <TransportesPerfilClient transporte={transporte} configuraciones={configuraciones ?? []} />
    </div>
  );
}
