/**
 * Supabase client factories.
 *
 * Three clients, because they answer to three different authorities:
 *
 *   browser   — the anon key, the signed-in user's session, RLS applies
 *   server    — same user, but reading cookies on the server
 *   service   — the service-role key, RLS does NOT apply
 *
 * The service client is the dangerous one. It exists so route handlers can do
 * the things a browser is deliberately barred from — freezing a snapshot,
 * recording a notice as sent, writing the audit log — and it must never be
 * constructed anywhere a request's user could influence what it does without
 * an explicit permission check first.
 */

import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';
import type { Database } from './database.types';

/** For client components. Carries the signed-in user; every query is RLS-gated. */
export function createBrowserSupabase() {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}

/** The cookie plumbing Next.js hands us, kept generic so this file imports no Next internals. */
export interface CookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

/**
 * For server components and route handlers, acting as the signed-in user.
 * Row-level security still applies, which is what makes this the default choice
 * on the server — reach for the service client only when you mean to.
 */
export function createServerSupabase(cookies: CookieStore) {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookies.set(name, value, options));
        } catch {
          // Server components cannot set cookies. Refresh is handled by
          // middleware, so this is safe to ignore rather than crash a render.
        }
      },
    },
  });
}

/**
 * Bypasses row-level security entirely.
 *
 * Only for privileged operations that the database refuses to let a browser
 * perform: writing `call_results`, `notices` and `audit_log`. Whoever calls
 * this is responsible for having checked that the current user is allowed to do
 * what is about to happen — none of the usual policies will do it for them.
 *
 * Sessions are disabled so this client can never pick up a user's cookie and
 * quietly act as somebody.
 */
export function createServiceSupabase() {
  const { supabaseUrl } = publicEnv();
  const { supabaseServiceRoleKey } = serverEnv();
  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Any of the three. Used by code that works the same whoever is asking. */
export type SupabaseClient = ReturnType<typeof createBrowserSupabase>;
