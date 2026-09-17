import { redirect } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';

/**
 * There is no cross-fund landing page — work always happens inside one fund —
 * so this opens the first one the user can see.
 */
export default async function RootPage() {
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);
  const clients = await repo.listClients();

  if (clients.length > 0) redirect(`/clients/${clients[0].id}`);

  // Signed in, but a member of no firm or a firm with no funds. Say so plainly
  // rather than showing an empty fund picker.
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 'min(100%, 460px)' }} bodyPadding="28px">
        <h3>No funds yet</h3>
        <p className="text-muted">
          Your account is not attached to a fund. Ask an administrator at your firm to add you, or
          create the first fund from the header once you have access.
        </p>
      </Card>
    </main>
  );
}
