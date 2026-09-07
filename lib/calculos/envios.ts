import type {
  ConfiguracionEnvio,
  Transporte,
  Tag,
  TarifaBulto,
  TarifaPallet,
  ResultadoEnvio,
  DesglosePrecio,
  DesgloseItem,
  UbicacionSeleccionada,
  BusquedaEnvio,
} from '@/lib/types/database';

// ── Estructura interna con relaciones ─────────────────────────────────────────

export interface ConfiguracionConDatos extends ConfiguracionEnvio {
  tarifas_bulto: TarifaBulto[];
  tarifas_pallet: TarifaPallet[];
  transportes: Transporte;
  // Los tags vienen anidados desde Supabase como configuracion_tags[].tags
  configuracion_tags?: Array<{ tag_id: string; tags: Tag | null }>;
  // También puede venir aplanado directamente
  tags?: Tag[];
}

/** Compara nombres de Georef y datos importados sin diferencias de tildes o mayúsculas. */
export function normalizarUbicacion(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-AR');
}

/** Extrae los tags de una configuración independientemente de cómo vengan de Supabase */
export function extraerTags(config: ConfiguracionConDatos): Tag[] {
  // Si ya vienen aplanados (tags directos)
  if (config.tags && config.tags.length > 0) return config.tags;
  // Si vienen anidados en configuracion_tags[].tags
  if (config.configuracion_tags) {
    return config.configuracion_tags
      .map((ct) => ct.tags)
      .filter((t): t is Tag => t !== null);
  }
  return [];
}

// ── Filtrado de candidatos ─────────────────────────────────────────────────────

export function filtrarConfiguraciones(
  configuraciones: ConfiguracionConDatos[],
  busqueda: BusquedaEnvio
): ConfiguracionConDatos[] {
  const { origen, destino, cantidadBultos, cantidadPallets, camionCompleto } = busqueda;
  const activas = configuraciones.filter((c) => c.activo);

  // Matchear ruta
  const matcheadoras = activas.filter((c) => {
    const matchOrigen =
      normalizarUbicacion(c.origen_provincia) === normalizarUbicacion(origen.provincia) &&
      (c.origen_localidad === null ||
        (origen.localidad !== null &&
          normalizarUbicacion(c.origen_localidad) === normalizarUbicacion(origen.localidad)));

    const matchDestino =
      normalizarUbicacion(c.destino_provincia) === normalizarUbicacion(destino.provincia) &&
      (c.destino_localidad === null ||
        (destino.localidad !== null &&
          normalizarUbicacion(c.destino_localidad) === normalizarUbicacion(destino.localidad)));

    return matchOrigen && matchDestino;
  });

  // Priorizar más específica por transporte
  const porTransporte = new Map<string, ConfiguracionConDatos>();
  for (const config of matcheadoras) {
    const existing = porTransporte.get(config.transporte_id);
    if (!existing) {
      porTransporte.set(config.transporte_id, config);
    } else {
      const espec = (c: ConfiguracionConDatos) =>
        (c.origen_localidad ? 1 : 0) + (c.destino_localidad ? 1 : 0);
      if (espec(config) > espec(existing)) {
        porTransporte.set(config.transporte_id, config);
      }
    }
  }

  // Filtrar las que tienen datos para lo que se pide + filtro peritoneal
  return Array.from(porTransporte.values()).filter((c) => {
    if (cantidadBultos > 0 && (!c.tarifas_bulto || c.tarifas_bulto.length === 0)) return false;
    if (cantidadPallets > 0 && (!c.tarifas_pallet || c.tarifas_pallet.length === 0)) return false;
    if (camionCompleto && (c.precio_camion_completo === null || c.precio_camion_completo === undefined)) return false;
    if (busqueda.soloPeritoneal && !c.apto_peritoneal) return false;
    return true;
  });
}

// ── Cálculo de precio total ────────────────────────────────────────────────────

export function calcularPrecio(
  config: ConfiguracionConDatos,
  busqueda: BusquedaEnvio
): DesglosePrecio {
  const items: DesgloseItem[] = [];
  let total = 0;

  // Bultos
  if (busqueda.cantidadBultos > 0) {
    const desgloseBultos = calcularBultos(config.tarifas_bulto, busqueda.cantidadBultos);
    items.push(...desgloseBultos.items);
    total += desgloseBultos.total;
  }

  // Pallets
  if (busqueda.cantidadPallets > 0) {
    const desglosePallets = calcularPallets(config.tarifas_pallet, busqueda.cantidadPallets);
    items.push(...desglosePallets.items);
    total += desglosePallets.total;
  }

  // Camión completo
  if (busqueda.camionCompleto) {
    const precio = config.precio_camion_completo!;
    items.push({
      descripcion: 'Camión completo (precio fijo)',
      precio,
      subtotal: precio,
    });
    total += precio;
  }

  return { items, total };
}

function calcularBultos(
  tarifas: TarifaBulto[],
  cantidad: number
): DesglosePrecio {
  if (tarifas.length === 0) return { items: [], total: 0 };

  const tramosAsc = [...tarifas].sort((a, b) => a.desde_bulto - b.desde_bulto);
  const tramosDesc = [...tramosAsc].reverse();

  // Verificar si el tramo 1 tiene es_valor_inicial = true
  const tramoInicial = tramosAsc.find((t) => t.desde_bulto === 1);
  const tieneValorInicial = tramoInicial?.es_valor_inicial === true;

  const items: DesgloseItem[] = [];
  let total = 0;

  if (tieneValorInicial && tramoInicial && cantidad > 1) {
    // MODO VALOR INICIAL:
    // - El bulto 1 siempre se cobra al precio del tramo 1 (precio de entrada fijo)
    // - Los bultos 2..N se calculan al precio del tramo vigente para la cantidad N
    //   (es decir, el tramo de mayor desde_bulto que sea <= cantidad)

    // Cargo el bulto inicial
    items.push({
      descripcion: `Bulto 1 (valor inicial) × ${formatearPrecio(tramoInicial.precio)}`,
      precio: tramoInicial.precio,
      cantidad: 1,
      subtotal: tramoInicial.precio,
    });
    total += tramoInicial.precio;

    // Para los bultos restantes (2..cantidad), busco el tramo vigente para esa cantidad.
    // Si todavía no se alcanzó el siguiente tramo, mantienen el valor inicial.
    const tramoResto = tramosDesc.find((t) => t.desde_bulto <= cantidad && t.desde_bulto > 1)
      ?? tramoInicial;

    const cantResto = cantidad - 1;
    if (cantResto > 0) {
      items.push({
        descripcion: `Bultos 2–${cantidad} (${cantResto} × ${formatearPrecio(tramoResto.precio)})`,
        precio: tramoResto.precio,
        cantidad: cantResto,
        subtotal: tramoResto.precio * cantResto,
      });
      total += tramoResto.precio * cantResto;
    }

  } else {
    // MODO TRAMO VIGENTE:
    // Toda la cantidad usa el precio del tramo alcanzado por la cantidad total.
    const tramo = tramosDesc.find((t) => t.desde_bulto <= cantidad) ?? tramosAsc[0];
    const subtotal = tramo.precio * cantidad;

    items.push({
      descripcion: `${formatearCantidad(cantidad)} bulto${cantidad !== 1 ? 's' : ''} × ${formatearPrecio(tramo.precio)}`,
      precio: tramo.precio,
      cantidad,
      subtotal,
    });
    total = subtotal;
  }

  return { items, total };
}

function calcularPallets(
  tarifas: TarifaPallet[],
  cantidad: number
): DesglosePrecio {
  if (tarifas.length === 0) return { items: [], total: 0 };

  // Ordenar tramos ascendente por desde_pallet
  const tramosAsc = [...tarifas].sort((a, b) => a.desde_pallet - b.desde_pallet);

  // Encontrar el tramo vigente: el de mayor desde_pallet que sea <= cantidad
  // (misma lógica que bultos, pero los valores son discretos del preset)
  const tramosDesc = [...tramosAsc].reverse();
  const tramo = tramosDesc.find((t) => t.desde_pallet <= cantidad);

  if (!tramo) {
    // Si la cantidad es menor que el primer tramo, usar el primero
    const primero = tramosAsc[0];
    const subtotal = primero.precio * cantidad;
    return {
      items: [{
        descripcion: `${formatearCantidad(cantidad)} pallet${cantidad !== 1 ? 's' : ''} × ${formatearPrecio(primero.precio)}`,
        precio: primero.precio,
        cantidad,
        subtotal,
      }],
      total: subtotal,
    };
  }

  const subtotal = tramo.precio * cantidad;
  return {
    items: [{
      descripcion: `${formatearCantidad(cantidad)} pallet${cantidad !== 1 ? 's' : ''} × ${formatearPrecio(tramo.precio)} (tramo desde ${tramo.desde_pallet})`,
      precio: tramo.precio,
      cantidad,
      subtotal,
    }],
    total: subtotal,
  };
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export function calcularRanking(
  candidatos: Array<{
    config: ConfiguracionConDatos;
    desglose: DesglosePrecio;
  }>
): ResultadoEnvio[] {
  if (candidatos.length === 0) return [];

  const precios = candidatos.map((c) => c.desglose.total);
  const tiempos = candidatos.map((c) => {
    const min = c.config.tiempo_estimado_min_horas ?? 0;
    const max = c.config.tiempo_estimado_max_horas ?? min;
    return (min + max) / 2;
  });

  const minP = Math.min(...precios), maxP = Math.max(...precios);
  const minT = Math.min(...tiempos), maxT = Math.max(...tiempos);
  const rangoP = maxP - minP, rangoT = maxT - minT;

  return candidatos
    .map((c, i) => {
      const pNorm = rangoP === 0 ? 0 : (precios[i] - minP) / rangoP;
      const tNorm = rangoT === 0 ? 0 : (tiempos[i] - minT) / rangoT;
      const score = 0.6 * pNorm + 0.4 * tNorm;

      return {
        configuracion: c.config,
        transporte: c.config.transportes,
        tags: extraerTags(c.config),
        precioTotal: c.desglose.total,
        tiempoMin: c.config.tiempo_estimado_min_horas,
        tiempoMax: c.config.tiempo_estimado_max_horas,
        score,
        desglose: c.desglose,
      };
    })
    .sort((a, b) => a.score - b.score);
}

// ── Formato ───────────────────────────────────────────────────────────────────

export function formatearPrecio(valor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valor);
}

export function formatearTiempo(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'Sin datos de tiempo';
  if (min === null) return `Hasta ${max} hs`;
  if (max === null || min === max) return `${min} hs`;
  if (min >= 24 && max >= 24) {
    const dMin = Math.floor(min / 24), dMax = Math.floor(max / 24);
    if (dMin === dMax) return `${dMin} día${dMin > 1 ? 's' : ''}`;
    return `${dMin}–${dMax} días`;
  }
  return `${min}–${max} hs`;
}

function formatearCantidad(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
