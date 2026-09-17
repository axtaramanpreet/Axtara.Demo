/**
 * Connection details for the local Supabase stack the integration tests use.
 *
 * The fallback keys are the Supabase CLI's well-known development keys. They
 * are signed with a published secret and are only ever valid against
 * 127.0.0.1, so checking them in costs nothing — and the alternative, reading
 * them from the environment alone, means the integration suite silently skips
 * on a fresh clone.
 *
 * Not a `.test.ts` file, so vitest treats it as a module rather than a suite.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

export const LOCAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

export const LOCAL_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const LOCAL_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** A client with no session of its own, so tests never leak auth between them. */
export function createLocalClient(key: string) {
  return createClient<Database>(LOCAL_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Bypasses row-level security. Use only to arrange state a user could not. */
export function createLocalServiceClient() {
  return createLocalClient(LOCAL_SERVICE_KEY);
}
