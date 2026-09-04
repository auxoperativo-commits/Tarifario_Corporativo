-- =========================================================
-- TRIGGER: crear perfil automáticamente al registrar usuario
-- Ejecutar en el SQL Editor de Supabase DESPUÉS del schema principal
-- =========================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.perfiles_usuario (id, nombre_completo, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre_completo', null),
    'operario'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger que dispara la función al registrar un nuevo usuario en auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
