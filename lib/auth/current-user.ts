import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { PerfilUsuario } from '@/lib/types/database';

/** Shared for the lifetime of one server render. */
export const getCurrentUserProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, perfil: null };
  }

  const { data: perfil } = await supabase
    .from('perfiles_usuario')
    .select('*')
    .eq('id', user.id)
    .single();

  return { user, perfil: perfil as PerfilUsuario | null };
});
