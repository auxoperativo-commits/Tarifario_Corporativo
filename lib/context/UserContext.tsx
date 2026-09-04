'use client';

import { createContext, useContext } from 'react';
import type { PerfilUsuario } from '@/lib/types/database';

interface UserContextValue {
  perfil: PerfilUsuario;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  perfil,
  children,
}: {
  perfil: PerfilUsuario;
  children: React.ReactNode;
}) {
  return (
    <UserContext.Provider value={{ perfil }}>{children}</UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser debe usarse dentro de UserProvider');
  return ctx;
}
