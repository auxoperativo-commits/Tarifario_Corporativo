'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

export type TransportePickerItem = { id: string; razon_social: string; nombre_fantasia: string | null };

export function TransportesPickerView({
  id, query, onQuery, suggestions, selected, loading, searching, error, placeholder,
  onSelect, onRemove, onRetry,
}: {
  id: string; query: string; onQuery: (value: string) => void; suggestions: TransportePickerItem[];
  selected: TransportePickerItem[]; loading?: boolean; searching?: boolean; error?: string | null;
  placeholder?: string; onSelect: (item: TransportePickerItem) => void; onRemove: (id: string) => void;
  onRetry?: () => void;
}) {
  return <div className="space-y-2">
    <Input id={id} role="combobox" aria-expanded={query.trim().length >= 1} aria-controls={`${id}-options`} aria-autocomplete="list" autoComplete="off" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={loading ? 'Cargando transportes...' : placeholder ?? 'Buscá un transporte para empezar'} />
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando transportes...</p>}
    {searching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando...</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{onRetry && <button type="button" className="underline" onClick={onRetry}>Reintentar</button>}</div>}
    {!loading && !searching && !error && query.trim() && suggestions.length === 0 && <p className="text-sm text-muted-foreground">Sin resultados</p>}
    {suggestions.length > 0 && <ul id={`${id}-options`} role="listbox" className="max-h-52 overflow-auto rounded-md border">{suggestions.map((item) => <li key={item.id} role="option" aria-selected="false"><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onSelect(item)}>{item.nombre_fantasia || item.razon_social}{item.nombre_fantasia && <span className="ml-2 text-muted-foreground">{item.razon_social}</span>}</button></li>)}</ul>}
    {selected.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Transportes elegidos">{selected.map((item) => <Badge key={item.id} variant="secondary" className="gap-2 py-1">{item.nombre_fantasia || item.razon_social}<button type="button" aria-label={`Quitar ${item.nombre_fantasia || item.razon_social}`} className="rounded-full hover:text-destructive" onClick={() => onRemove(item.id)}>×</button></Badge>)}</div>}
  </div>;
}
