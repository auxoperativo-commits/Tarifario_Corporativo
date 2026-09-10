'use client';

import Link from 'next/link';
import { ArrowLeft, Mail, MapPin, Phone, Settings, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Transporte } from '@/lib/types/database';

interface ConfiguracionResumen {
  id: string;
  origen_provincia: string;
  origen_localidad: string | null;
  origen_nombre_personalizado?: string | null;
  destino_provincia: string;
  destino_localidad: string | null;
  destino_nombre_personalizado?: string | null;
  activo: boolean;
}

function formatearRutaResumen(config: ConfiguracionResumen): string {
  const origen = config.origen_nombre_personalizado ? `${config.origen_provincia} (${config.origen_nombre_personalizado})${config.origen_localidad ? ` · ${config.origen_localidad}` : ''}` : (config.origen_localidad ? `${config.origen_provincia} · ${config.origen_localidad}` : config.origen_provincia);
  const destino = config.destino_nombre_personalizado ? `${config.destino_provincia} (${config.destino_nombre_personalizado})${config.destino_localidad ? ` · ${config.destino_localidad}` : ''}` : (config.destino_localidad ? `${config.destino_provincia} · ${config.destino_localidad}` : config.destino_provincia);
  return `${origen} → ${destino}`;
}

export function TransportesPerfilClient({ transporte, configuraciones }: { transporte: Transporte; configuraciones: ConfiguracionResumen[] }) {
  const telefonoWhatsApp = transporte.telefono?.replace(/[^\d]/g, '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link href="/envios"><ArrowLeft className="mr-2 h-4 w-4" />Volver a Envíos</Link>
        </Button>
        <Button asChild variant="ghost" className="px-0">
          <Link href="/transportes"><ArrowLeft className="mr-2 h-4 w-4" />Volver a transportes</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-3"><Truck className="h-6 w-6 text-primary" /></div>
            <div>
              <CardTitle className="text-xl">{transporte.nombre_fantasia || transporte.razon_social}</CardTitle>
              {transporte.nombre_fantasia && <p className="text-sm text-muted-foreground mt-1">Razón social: {transporte.razon_social}</p>}
              <Badge className="mt-2" variant={transporte.activo ? 'default' : 'secondary'}>{transporte.activo ? 'Activo' : 'Inactivo'}</Badge>
            </div>
          </div>
          <Button asChild variant="outline" size="sm"><Link href={`/configuraciones?transporte=${transporte.id}`}><Settings className="mr-2 h-4 w-4" />Configuraciones</Link></Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-muted-foreground" />{transporte.telefono || 'Sin teléfono'}</div>
          <div className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-muted-foreground" />{transporte.correo || 'Sin correo'}</div>
          {transporte.cuit && <div className="text-sm"><span className="text-muted-foreground">CUIT:</span> {transporte.cuit}</div>}
          {transporte.observacion && <div className="text-sm sm:col-span-2"><span className="text-muted-foreground">Observaciones:</span> {transporte.observacion}</div>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {telefonoWhatsApp && <Button asChild size="sm" className="bg-green-600 hover:bg-green-700"><a href={`https://wa.me/${telefonoWhatsApp}`} target="_blank" rel="noreferrer"><Phone className="mr-2 h-4 w-4" />WhatsApp</a></Button>}
            {transporte.correo && <Button asChild size="sm" variant="outline"><a href={`mailto:${transporte.correo}`}><Mail className="mr-2 h-4 w-4" />Enviar correo</a></Button>}
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Rutas configuradas ({configuraciones.length})</h2>
        {configuraciones.length === 0 ? <p className="text-sm text-muted-foreground">Este transporte todavía no tiene rutas configuradas.</p> : <div className="grid gap-2">{configuraciones.map((config) => <Link key={config.id} href={`/configuraciones?transporte=${transporte.id}`} className="flex items-center justify-between rounded-lg border bg-white p-3 hover:border-primary"><span className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-muted-foreground" />{formatearRutaResumen(config)}</span><Badge variant={config.activo ? 'default' : 'secondary'}>{config.activo ? 'Activa' : 'Inactiva'}</Badge></Link>)}</div>}
      </section>
    </div>
  );
}
