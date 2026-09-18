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
 * only act on one of them: a member of a firm can make the first fund, and
 * somebody in no firm can do nothing but ask. Telling both the same thing once
 * left a signed-in owner staring at advice to "create the first fund from the
 * header", on the one page that has no header.
 */
export default async function RootPage() {
  const supabase = await getServerSupabase();
  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);
  const clients = await repo.listClients();

  if (clients.length > 0) redirect(`/clients/${clients[0].id}`);

  // Row-level security limits this to firms the signed-in user belongs to, so
  // an empty result means exactly "you are in no firm".
  const { data: firms } = await supabase.from('firms').select('id, name');
  const firm = firms?.[0];

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 'min(100%, 460px)' }} bodyPadding="28px">
        <h3>No funds yet</h3>

        {firm ? (
          <>
            <p className="text-muted">
              You are signed in to <strong>{firm.name}</strong>, which has no funds. Create one to
              start a capital call — you can upload the register now or fill it in later.
            </p>
            <CreateFirstFund />
          </>
        ) : (
          <p className="text-muted">
            Your account is not attached to a firm yet, so there is nowhere to put a fund. Ask an
            administrator to add you.
          </p>
        )}
      </Card>
    </main>
  );
}
