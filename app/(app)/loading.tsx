export default function Loading() {
  return (
    <div className="space-y-6" aria-label="Cargando módulo">
      <div className="h-8 w-56 animate-pulse rounded-md bg-slate-200" />
      <div className="h-4 w-80 animate-pulse rounded bg-slate-200" />
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl border bg-white" />
        <div className="h-24 animate-pulse rounded-xl border bg-white" />
      </div>
    </div>
  );
}
