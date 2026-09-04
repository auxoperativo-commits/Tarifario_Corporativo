'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signOut } from '@/app/actions/auth';
import { UserProvider } from '@/lib/context/UserContext';
import type { PerfilUsuario, Rol } from '@/lib/types/database';
import {
  Package2,
  Truck,
  Settings,
  Tags,
  User,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

// ─── Constantes de navegación ──────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    href: '/envios',
    label: 'Envíos',
    icon: Package2,
    roles: ['operario', 'compras', 'licitaciones', 'gerencia', 'admin'] as Rol[],
  },
  {
    href: '/transportes',
    label: 'Transportes',
    icon: Truck,
    roles: ['compras', 'licitaciones', 'gerencia', 'admin'] as Rol[],
  },
  {
    href: '/configuraciones',
    label: 'Configuraciones',
    icon: Settings,
    roles: ['compras', 'licitaciones', 'gerencia', 'admin'] as Rol[],
  },
  {
    href: '/tags',
    label: 'Tags',
    icon: Tags,
    roles: ['compras', 'licitaciones', 'gerencia', 'admin'] as Rol[],
  },
];

const ROL_LABELS: Record<Rol, string> = {
  operario: 'Operario',
  compras: 'Compras',
  licitaciones: 'Licitaciones',
  gerencia: 'Gerencia',
  admin: 'Administrador',
};

const ROL_COLORS: Record<Rol, string> = {
  operario: 'bg-slate-100 text-slate-700',
  compras: 'bg-blue-100 text-blue-700',
  licitaciones: 'bg-purple-100 text-purple-700',
  gerencia: 'bg-amber-100 text-amber-700',
  admin: 'bg-red-100 text-red-700',
};

// ─── Componente ────────────────────────────────────────────────────────────────

interface AppShellProps {
  perfil: PerfilUsuario;
  children: React.ReactNode;
}

export function AppShell({ perfil, children }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.roles.includes(perfil.rol)
  );

  const displayName =
    perfil.nombre_completo ??
    'Usuario';

  return (
    <UserProvider perfil={perfil}>
    <div className="min-h-screen flex bg-slate-50">
      {/* ── Sidebar desktop ── */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r shrink-0">
        <SidebarContent
          perfil={perfil}
          pathname={pathname}
          visibleItems={visibleItems}
          displayName={displayName}
        />
      </aside>

      {/* ── Overlay mobile ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar mobile ── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r flex flex-col transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <BrandLogo />
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1 hover:bg-muted"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <SidebarContent
          perfil={perfil}
          pathname={pathname}
          visibleItems={visibleItems}
          displayName={displayName}
          onNavClick={() => setMobileOpen(false)}
          hideBrand
        />
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar mobile */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 hover:bg-muted"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <BrandLogo />
          <div className="ml-auto text-sm text-muted-foreground truncate max-w-[120px]">
            {displayName}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
    </UserProvider>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────────

function BrandLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-primary rounded-lg p-1.5">
        <Package2 className="h-5 w-5 text-white" />
      </div>
      <div className="leading-none">
        <p className="font-bold text-sm text-slate-800">Tarifario</p>
        <p className="text-xs text-slate-400">Salud Renal</p>
      </div>
    </div>
  );
}

function SidebarContent({
  perfil,
  pathname,
  visibleItems,
  displayName,
  onNavClick,
  hideBrand,
}: {
  perfil: PerfilUsuario;
  pathname: string;
  visibleItems: typeof NAV_ITEMS;
  displayName: string;
  onNavClick?: () => void;
  hideBrand?: boolean;
}) {
  return (
    <>
      {!hideBrand && (
        <div className="p-5 border-b">
          <BrandLogo />
        </div>
      )}

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
              {active && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
            </Link>
          );
        })}
      </nav>

      <Separator />

      <div className="p-3 space-y-0.5">
        <Link
          href="/perfil"
          onClick={onNavClick}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            pathname === '/perfil'
              ? 'bg-primary text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          )}
        >
          <User className="h-4 w-4 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="truncate">{displayName}</p>
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded-full font-normal',
                pathname === '/perfil'
                  ? 'bg-white/20 text-white'
                  : ROL_COLORS[perfil.rol]
              )}
            >
              {ROL_LABELS[perfil.rol]}
            </span>
          </div>
        </Link>

        <form action={signOut}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </>
  );
}

// ─── Hook de permisos (client-side) ───────────────────────────────────────────

export function puedeEditar(rol: Rol): boolean {
  return ['compras', 'licitaciones', 'gerencia', 'admin'].includes(rol);
}

export function esAdmin(rol: Rol): boolean {
  return rol === 'admin';
}
