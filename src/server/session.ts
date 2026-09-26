import { getServerSupabase } from '@/lib/supabase/server';

/** A Supabase client acting as a signed-in user: row-level security applies. */
export type UserSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

/**
 * Who the server acts as. Normally the user of the current request, from its
 * cookies. A caller outside a request — the demo fund script — signs in and
 * passes its own client, so it goes through exactly the same checks.
 */
export async function userSupabase(client?: UserSupabase): Promise<UserSupabase> {
  return client ?? getServerSupabase();
}
