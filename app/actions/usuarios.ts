'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Rol } from '@/lib/types/database';

interface CrearUsuarioInput {
  email: string;
  password: string;
  nombre: string;
  rol: Rol;
}

export async function crearUsuario(input: CrearUsuarioInput) {
  const supabase = await createClient();
  const { data: { user: actor } } = await supabase.auth.getUser();
  if (!actor) return { error: 'Sesión expirada.' };

  const { data: perfilActor } = await supabase
    .from('perfiles_usuario')
    .select('rol')
    .eq('id', actor.id)
    .single();
  if (perfilActor?.rol !== 'admin') return { error: 'Solo un administrador puede crear usuarios.' };

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) return { error: 'Ingresá un correo válido.' };
  if (input.password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' };
  if (!['operario', 'admin'].includes(input.rol)) return { error: 'Rol inválido.' };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { nombre_completo: input.nombre.trim() || null },
  });
  if (error || !data.user) return { error: error?.message ?? 'No se pudo crear el usuario.' };

  const { error: perfilError } = await admin
    .from('perfiles_usuario')
    .update({ nombre_completo: input.nombre.trim() || null, rol: input.rol })
    .eq('id', data.user.id);
  if (perfilError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: perfilError.message };
  }
  return { ok: true };
}
