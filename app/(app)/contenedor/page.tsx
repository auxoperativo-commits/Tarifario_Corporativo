import { createClient } from '@/lib/supabase/server';
import { ContenedorClient } from './ContenedorClient';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata = { title: 'Contenedor — Tarifario' };

export default async function ContenedorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: contenedores } = await supabase
    .from('contenedores')
    .select('*')
    .eq('usuario_id', user.id)
    .order('created_at', { ascending: false });

  const { data: cotizaciones } = await supabase
    .from('contenedor_cotizaciones')
    .select('*');

  const contenedorIds = new Set((contenedores ?? []).map((item) => item.id));
  const cotizacionesDelUsuario = (cotizaciones ?? []).filter((cotizacion) => contenedorIds.has(cotizacion.contenedor_id));

  return (
    <div>
      <PageHeader
        title="Contenedor"
        description="Guardá cotizaciones por usuario y armá un resumen final por envío"
      />
      <ContenedorClient contenedoresIniciales={contenedores ?? []} cotizacionesIniciales={cotizacionesDelUsuario} />
    </div>
  );
}
