import { NextResponse } from 'next/server';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { buildFundContext } from '@/server/fund-context';
import {
  complete,
  pointerLabel,
  stripMarkdown,
  systemPrompt,
  takePointer,
  type Message,
} from '@/server/ask';
import type { CallDetail } from '@/adapters/storage/types';

/**
 * One question about one fund.
 *
 * Everything happens here rather than in the browser for two reasons. The model
 * key must never reach a bundle; and the fund data the answer is grounded in is
 * read **as the signed-in user**, so row-level security decides which funds can
 * be asked about. A service-role client would bypass that and let anyone ask
 * about anyone's register.
 *
 * Read-only by construction: this route loads and computes. It has no path that
 * writes.
 */
export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { clientId?: string; question?: string; history?: Message[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const question = String(body.question ?? '').trim();
  if (!body.clientId || !question) {
    return NextResponse.json({ error: 'A fund and a question are needed.' }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 });

  const repo = createSupabaseRepository(supabase as unknown as SupabaseClient);

  // Reading as the user: a fund they cannot see simply is not in this list, and
  // the question is refused the same way a missing fund would be.
  const clients = await repo.listClients();
  const client = clients.find((c) => c.id === body.clientId);
  if (!client) {
    return NextResponse.json({ error: 'That fund could not be found.' }, { status: 404 });
  }

  const summaries = await repo.listCalls(client.id);
  const calls = (await Promise.all(summaries.map((c) => repo.getCall(c.id)))).filter(
    (c): c is CallDetail => c !== null,
  );

  const context = buildFundContext(client, calls);

  // The last eight turns, as the contract says — enough for "and the one
  // before it?" to mean something, short enough that the snapshot dominates.
  const history = (body.history ?? [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-8);

  let raw: string;
  try {
    raw = await complete(systemPrompt(context), [...history, { role: 'user', content: question }]);
  } catch (e) {
    // The provider's own words. Anything else here is a guess about why.
    const reason = e instanceof Error ? e.message : 'the model could not be reached';
    return NextResponse.json({ error: `Ask Axtara could not answer — ${reason}` }, { status: 502 });
  }

  const { reply, pointer } = takePointer(stripMarkdown(raw));

  // Resolved here because only the server knows which call has which id. A
  // pointer at a call this fund does not have becomes no link at all.
  const target = pointer ? calls.find((c) => c.callNo === pointer.callNo) : undefined;
  const goto =
    pointer && target
      ? {
          href: `/clients/${client.id}/calls/${target.id}?tab=${pointer.tab}`,
          label: pointerLabel(pointer),
        }
      : null;

  return NextResponse.json({ reply, goto });
}
