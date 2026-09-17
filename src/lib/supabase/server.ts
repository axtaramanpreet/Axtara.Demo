import { cookies } from 'next/headers';
import { createServerSupabase } from '@/adapters/storage/supabase-client';

/**
 * A Supabase client for the current request, acting as the signed-in user.
 *
 * Row-level security applies, which makes this the right default everywhere on
 * the server. The service-role client exists for the three privileged writes
 * and should be reached for deliberately, never as a convenience.
 */
export async function getServerSupabase() {
  const store = await cookies();
  return createServerSupabase({
    getAll: () => store.getAll(),
    set: (name, value, options) => store.set(name, value, options),
  });
}

/** The signed-in user, or null. */
export async function getCurrentUser() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
