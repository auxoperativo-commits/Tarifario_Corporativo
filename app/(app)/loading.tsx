export default function Loading() {
  return (
    <div className="space-y-6" aria-label="Cargando módulo">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded-md bg-slate-200" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-slate-200" />
      </div>
      <div className="rounded-lg border bg-white">
        <div className="flex gap-3 border-b p-4">
          <div className="h-9 w-36 animate-pulse rounded-md bg-slate-100" />
          <div className="h-9 w-28 animate-pulse rounded-md bg-slate-100" />
          <div className="ml-auto h-9 w-32 animate-pulse rounded-md bg-slate-100" />
        </div>
        <div className="space-y-3 p-4">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="grid grid-cols-3 gap-4">
              <div className="h-5 animate-pulse rounded bg-slate-100" />
              <div className="h-5 animate-pulse rounded bg-slate-100" />
              <div className="h-5 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
