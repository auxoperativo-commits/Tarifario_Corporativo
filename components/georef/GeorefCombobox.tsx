'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronsUpDown, Loader2, MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { UbicacionSeleccionada } from '@/lib/types/database';

// ─── API Georef ────────────────────────────────────────────────────────────────

interface ProvinciaGeoref {
  id: string;
  nombre: string;
}

interface LocalidadGeoref {
  id: string;
  nombre: string;
  provincia: { id: string; nombre: string };
}

async function buscarProvincias(nombre: string): Promise<ProvinciaGeoref[]> {
  const params = new URLSearchParams({ max: '24', orden: 'nombre' });
  if (nombre.trim()) params.set('nombre', nombre.trim());
  try {
    const res = await fetch(
      `https://apis.datos.gob.ar/georef/api/provincias?${params}`,
      { cache: 'force-cache' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.provincias ?? []) as ProvinciaGeoref[];
  } catch {
    return [];
  }
}

// Cache de todas las provincias para filtrado local (más responsivo)
let _todasLasProvincias: ProvinciaGeoref[] | null = null;

async function obtenerTodasLasProvincias(): Promise<ProvinciaGeoref[]> {
  if (_todasLasProvincias) return _todasLasProvincias;
  const result = await buscarProvincias('');
  _todasLasProvincias = result;
  return result;
}

function filtrarProvinciasLocal(
  provincias: ProvinciaGeoref[],
  query: string
): ProvinciaGeoref[] {
  if (!query.trim()) return provincias;
  const q = query.toLowerCase().trim();
  // Normalizar para ignorar tildes
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const qNorm = norm(q);
  return provincias.filter((p) => norm(p.nombre).includes(qNorm));
}

async function buscarLocalidades(
  nombre: string,
  provincia: string
): Promise<LocalidadGeoref[]> {
  if (!nombre.trim()) return [];
  const params = new URLSearchParams({
    nombre: nombre.trim(),
    max: '15',
    orden: 'nombre',
  });
  if (provincia) params.set('provincia', provincia);
  try {
    const res = await fetch(
      `https://apis.datos.gob.ar/georef/api/localidades?${params}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.localidades ?? []) as LocalidadGeoref[];
  } catch {
    return [];
  }
}

// ─── Hook debounce ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Dropdown propio (sin cmdk, compatible con Dialog) ────────────────────────

interface DropdownProps {
  placeholder: string;
  value: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSelect: (v: string) => void;
  onClear?: () => void;
  items: { id: string; label: string }[];
  loading: boolean;
  emptyText: string;
  disabled?: boolean;
  id?: string;
}

function Dropdown({
  placeholder,
  value,
  inputValue,
  onInputChange,
  onSelect,
  onClear,
  items,
  loading,
  emptyText,
  disabled,
  id,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleTriggerClick() {
    if (disabled) return;
    setOpen((prev) => !prev);
    if (!open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }

  function handleItemClick(label: string) {
    onSelect(label);
    setOpen(false);
    onInputChange('');
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={handleTriggerClick}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          !value && 'text-muted-foreground'
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{value || placeholder}</span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {value && onClear && (
            <span
              role="button"
              tabIndex={0}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onClear();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onClear();
                }
              }}
              className="rounded-full hover:bg-muted p-0.5"
              aria-label="Limpiar"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </div>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-[200] mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg">
          {/* Input de búsqueda */}
          <div className="flex items-center border-b px-3 py-2">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
            ) : (
              <MapPin className="mr-2 h-4 w-4 shrink-0 opacity-40" />
            )}
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Escribir para buscar..."
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && items.length === 1) {
                  handleItemClick(items[0].label);
                }
              }}
            />
          </div>

          {/* Lista */}
          <ul
            className="max-h-60 overflow-y-auto p-1"
            role="listbox"
          >
            {items.length === 0 ? (
              <li className="py-4 text-center text-sm text-muted-foreground">
                {loading ? 'Buscando...' : emptyText}
              </li>
            ) : (
              items.map((item) => (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={value === item.label}
                  // Usamos onMouseDown en lugar de onClick para que se dispare
                  // antes de que el blur cierre el dropdown
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleItemClick(item.label);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2 py-2 text-sm cursor-pointer select-none',
                    'hover:bg-accent hover:text-accent-foreground',
                    value === item.label && 'bg-accent/50'
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      value === item.label ? 'opacity-100 text-primary' : 'opacity-0'
                    )}
                  />
                  {item.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Componente GeorefCombobox ─────────────────────────────────────────────────

interface GeorefComboboxProps {
  label: string;
  value: UbicacionSeleccionada | null;
  onChange: (val: UbicacionSeleccionada | null) => void;
  placeholder?: string;
  /** Si es true, la localidad es opcional (puede quedar null = toda la provincia) */
  localidadOpcional?: boolean;
  disabled?: boolean;
  className?: string;
}

export function GeorefCombobox({
  label,
  value,
  onChange,
  placeholder = 'Seleccionar provincia...',
  localidadOpcional = false,
  disabled = false,
  className,
}: GeorefComboboxProps) {
  // ── Provincia ──
  const [busquedaProv, setBusquedaProv] = useState('');
  const [todasProvincias, setTodasProvincias] = useState<ProvinciaGeoref[]>([]);
  const [provincias, setProvincias] = useState<ProvinciaGeoref[]>([]);
  const [loadingProv, setLoadingProv] = useState(false);
  const [provCargadas, setProvCargadas] = useState(false);

  // ── Localidad ──
  const [busquedaLoc, setBusquedaLoc] = useState('');
  const [localidades, setLocalidades] = useState<LocalidadGeoref[]>([]);
  const [loadingLoc, setLoadingLoc] = useState(false);

  const debouncedLoc = useDebounce(busquedaLoc, 300);

  // Cargar todas las provincias una vez al montar, luego filtrar local (instantáneo, sin debounce)
  useEffect(() => {
    setLoadingProv(true);
    obtenerTodasLasProvincias()
      .then((p) => {
        setTodasProvincias(p);
        setProvincias(p);
        setProvCargadas(true);
      })
      .finally(() => setLoadingProv(false));
  }, []);

  // Filtrado local de provincias: responde al instante, soporta búsqueda por palabra parcial
  useEffect(() => {
    setProvincias(filtrarProvinciasLocal(todasProvincias, busquedaProv));
  }, [busquedaProv, todasProvincias]);

  // Cargar localidades cuando cambia la búsqueda
  useEffect(() => {
    if (!value?.provincia || !debouncedLoc.trim()) {
      setLocalidades([]);
      return;
    }
    setLoadingLoc(true);
    buscarLocalidades(debouncedLoc, value.provincia)
      .then(setLocalidades)
      .finally(() => setLoadingLoc(false));
  }, [debouncedLoc, value?.provincia]);

  const seleccionarProvincia = useCallback(
    (nombre: string) => {
      const prov = provincias.find((p) => p.nombre === nombre);
      onChange({
        provincia: nombre,
        localidad: null,
        provinciaId: prov?.id,
      });
      setBusquedaLoc('');
      setLocalidades([]);
    },
    [provincias, onChange]
  );

  const seleccionarLocalidad = useCallback(
    (nombre: string) => {
      if (!value) return;
      const loc = localidades.find((l) => l.nombre === nombre);
      onChange({ ...value, localidad: nombre, localidadId: loc?.id });
    },
    [value, localidades, onChange]
  );

  const limpiarProvincia = useCallback(() => {
    onChange(null);
    setBusquedaProv('');
    setBusquedaLoc('');
    setLocalidades([]);
  }, [onChange]);

  const limpiarLocalidad = useCallback(() => {
    if (!value) return;
    onChange({ ...value, localidad: null, localidadId: undefined });
    setBusquedaLoc('');
  }, [value, onChange]);

  const provinciasItems = provincias.map((p) => ({ id: p.id, label: p.nombre }));
  const localidadesItems = localidades.map((l) => ({ id: l.id, label: l.nombre }));

  return (
    <div className={cn('space-y-2', className)}>
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </Label>

      {/* Provincia */}
      <Dropdown
        placeholder={placeholder}
        value={value?.provincia ?? ''}
        inputValue={busquedaProv}
        onInputChange={setBusquedaProv}
        onSelect={seleccionarProvincia}
        onClear={limpiarProvincia}
        items={provinciasItems}
        loading={loadingProv && !provCargadas}
        emptyText="No se encontraron provincias."
        disabled={disabled}
      />

      {/* Localidad — solo aparece si hay provincia seleccionada */}
      {value?.provincia && (
        <Dropdown
          placeholder={
            localidadOpcional
              ? 'Toda la provincia (opcional)'
              : 'Seleccionar localidad...'
          }
          value={value?.localidad ?? ''}
          inputValue={busquedaLoc}
          onInputChange={setBusquedaLoc}
          onSelect={seleccionarLocalidad}
          onClear={localidadOpcional ? limpiarLocalidad : undefined}
          items={localidadesItems}
          loading={loadingLoc}
          emptyText={
            busquedaLoc.trim()
              ? 'No se encontraron localidades.'
              : 'Escribí para buscar localidades.'
          }
          disabled={disabled}
        />
      )}
    </div>
  );
}
