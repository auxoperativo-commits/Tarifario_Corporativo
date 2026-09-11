// Tipos del esquema Supabase — Tarifario Salud Renal

export type Rol = 'operario' | 'admin';

// El historial guarda un string simple; la UI permite combinar tipos
export type TipoEnvio = 'bultos' | 'kg' | 'pallet' | 'camion_completo' | 'mixto';

export interface Transporte {
  id: string;
  razon_social: string;
  nombre_fantasia: string | null;
  cuit: string | null;
  telefono: string | null;
  correo: string | null;
  observacion: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  nombre: string;
  color: string;
  // Precios opcionales por unidad (solo presentes cuando se cargan con join)
  configuracion_tag_precios?: TagPrecio[];
}

/** Precio adicional de un tag dentro de una configuración de envío específica */
export interface TagPrecio {
  id: string;
  configuracion_id: string;
  tag_id: string;
  precio_bulto: number | null;
  precio_pallet: number | null;
  precio_kg: number | null;
  precio_camion_completo: number | null;
}

/** Cantidades enviadas con un tag específico (estado del formulario de envíos) */
export interface TagCantidad {
  bultos: number;          // 0 = no aplica
  pallets: number;         // 0 = no aplica
  kg: number;              // 0 = no aplica
  camionCompleto: boolean;
}

export interface ConfiguracionEnvio {
  id: string;
  transporte_id: string;
  origen_provincia: string;
  origen_localidad: string | null;
  origen_nombre_personalizado?: string | null;
  origen_ubicacion_personalizada_id?: string | null;
  destino_provincia: string;
  destino_localidad: string | null;
  destino_nombre_personalizado?: string | null;
  destino_ubicacion_personalizada_id?: string | null;
  tiempo_estimado_min_horas: number | null;
  tiempo_estimado_max_horas: number | null;
  precio_pallet: number | null;
  precio_camion_completo: number | null;
  precio_camion_actualizado_at?: string | null;
  apto_peritoneal: boolean;
  activo: boolean;
  es_copia?: boolean;
  configuracion_origen_id?: string | null;
  nombre_copia?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TarifaBulto {
  id: string;
  configuracion_id: string;
  desde_bulto: number;
  precio: number;
  // Si true: el bulto 1 se cobra siempre (precio inicial fijo) + el resto al tramo vigente.
  // Si false: toda la cantidad se multiplica por el precio del tramo vigente.
  es_valor_inicial: boolean;
  updated_at?: string;
}

export interface TarifaPallet {
  id: string;
  configuracion_id: string;
  desde_pallet: number; // soporta decimales: 0.5, 1, 1.5, 2, etc.
  precio: number;
  updated_at?: string;
}

export interface TarifaKg {
  id: string;
  configuracion_id: string;
  desde_kg: number;
  precio: number;
  updated_at?: string;
}

export interface ConfiguracionTag {
  configuracion_id: string;
  tag_id: string;
}

export interface PerfilUsuario {
  id: string;
  nombre_completo: string | null;
  rol: Rol;
  origen_predeterminado_provincia: string | null;
  origen_predeterminado_localidad: string | null;
  destino_predeterminado_provincia: string | null;
  destino_predeterminado_localidad: string | null;
  created_at: string;
}

export interface HistorialCalculo {
  id: string;
  usuario_id: string | null;
  origen_provincia: string;
  origen_localidad: string | null;
  destino_provincia: string;
  destino_localidad: string | null;
  tipo_envio: string;
  cantidad: number | null;
  transporte_elegido_id: string | null;
  precio_resultado: number | null;
  created_at: string;
}

export interface UbicacionPersonalizada {
  id: string;
  usuario_id: string;
  nombre: string;
  provincia: string;
  localidad: string | null;
  created_at: string;
}

export interface Contenedor {
  id: string;
  usuario_id: string;
  nombre: string;
  descripcion: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContenedorCotizacion {
  id: string;
  contenedor_id: string;
  configuracion_id: string | null;
  transporte_id: string | null;
  transporte_nombre: string | null;
  origen_provincia: string | null;
  origen_localidad: string | null;
  origen_nombre_personalizado?: string | null;
  destino_provincia: string | null;
  destino_localidad: string | null;
  destino_nombre_personalizado?: string | null;
  precio_total: number | null;
  cantidad_bultos: number | null;
  cantidad_pallets: number | null;
  cantidad_kg: number | null;
  descripcion: string | null;
  created_at: string;
}

// ── Tipos extendidos con relaciones ────────────────────────────────────────────

export interface ConfiguracionEnvioConRelaciones extends ConfiguracionEnvio {
  transportes?: Transporte;
  tarifas_bulto?: TarifaBulto[];
  tarifas_pallet?: TarifaPallet[];
  tags?: Tag[];
}

// ── Georef ─────────────────────────────────────────────────────────────────────

export interface UbicacionSeleccionada {
  provincia: string;
  localidad: string | null;
  provinciaId?: string;
  localidadId?: string;
  id?: string;
  nombre?: string;
  tipo?: 'georef' | 'personalizada';
}

// ── Resultados de búsqueda ─────────────────────────────────────────────────────

// Lo que el usuario ingresa en el formulario de búsqueda
export interface BusquedaEnvio {
  origen: UbicacionSeleccionada;
  destino: UbicacionSeleccionada;
  cantidadBultos: number;   // 0 = no aplica
  cantidadPallets: number;  // 0 = no aplica
  cantidadKg: number;        // 0 = no aplica
  camionCompleto: boolean;
  soloPeritoneal: boolean;  // si true: solo mostrar configuraciones apto_peritoneal = true
  // Tags seleccionados con sus cantidades para sumar costo adicional
  tagCantidades?: Record<string, TagCantidad>; // key = tag_id
}

export interface ResultadoEnvio {
  configuracion: ConfiguracionEnvio;
  transporte: Transporte;
  tags: Tag[];
  precioTotal: number;
  tiempoMin: number | null;
  tiempoMax: number | null;
  score: number;
  desglose: DesglosePrecio;
  origenSeleccionado?: UbicacionSeleccionada;
  destinoSeleccionado?: UbicacionSeleccionada;
  cantidadBultos?: number;
  cantidadPallets?: number;
  cantidadKg?: number;
  camionCompleto?: boolean;
}

export interface DesglosePrecio {
  items: DesgloseItem[];
  total: number;
}

export interface DesgloseItem {
  descripcion: string;
  precio: number;
  cantidad?: number;
  subtotal: number;
}
