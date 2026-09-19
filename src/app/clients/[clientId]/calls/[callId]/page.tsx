import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { CallScreen } from '@/components/call/call-screen';
import { emailStatusForClient } from '@/lib/env';

/**
 * One capital call: Summary, Allocation, Checks and Notices.
 *
 * Loaded on the server; the screen reads the current tab from the URL, so it
 * sits behind a Suspense boundary.
 */
export default async function CallPage({
  params,
}: {
  params: Promise<{ clientId: string; callId: string }>;
}) {
  const { clientId, callId } = await params;
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  const [clients, call] = await Promise.all([repo.listClients(), repo.getCall(callId)]);
  if (!call) notFound();

  return (
    <div className="app">
      <AppHeader clients={clients} currentClientId={clientId} />
      <main style={{ padding: '28px 40px 60px', flex: 1 }}>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <CallScreen call={call} clientId={clientId} email={emailStatusForClient()} />
        </Suspense>
      </main>
    </div>
  );
}
