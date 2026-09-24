import { redirect } from 'next/navigation';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { CreateFirstFund } from '@/components/home/create-first-fund';

/**
 * There is no cross-fund landing page — work always happens inside one fund —
 * so this opens the first one the user can see.
 *
 * When there is none, the two reasons are genuinely different and the user can
 * only act on one of them: someone who belongs to a client can make its first
 * fund, and somebody who belongs to no client can do nothing but ask. Telling
 * both the same thing once left a signed-in owner staring at advice to "create
 * the first fund from the header", on the one page that has no header.
 */
export default async function RootPage() {
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);
  const funds = await repo.listFunds();

  if (funds.length > 0) redirect(`/funds/${funds[0].id}`);

  // Row-level security limits this to clients the signed-in user belongs to, so
  // an empty result means exactly "you are in no client".
  const { data: clients } = await supabase.from('clients').select('id, name');
  const client = clients?.[0];

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 'min(100%, 460px)' }} bodyPadding="28px">
        <h3>No funds yet</h3>

        {client ? (
          <>
            <p className="text-muted">
              You are signed in to <strong>{client.name}</strong>, which has no funds. Create one to
              start a capital call — you can upload the register now or fill it in later.
            </p>
            <CreateFirstFund />
          </>
        ) : (
          <p className="text-muted">
            Your account is not attached to a client yet, so there is nowhere to put a fund. Ask an
            administrator to add you.
          </p>
        )}
      </Card>
    </main>
  );
}
