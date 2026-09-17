import { NextResponse } from 'next/server';
import { ActionError, approveNotices, revertNotices, sendNotices } from '@/server/call-actions';

/**
 * The notice workflow.
 *
 * This route exists because the browser cannot write `notices` directly — those
 * tables carry read policies only. Approving and sending are decisions with
 * consequences for investors, so they happen on the server, where the checks
 * can be re-run against stored inputs rather than taken on trust.
 *
 * The body says *which* investors and *what action*. It never says what they
 * owe; that is recomputed here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;

  let body: { action?: string; lpIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'approve':
        return NextResponse.json(await approveNotices(callId, body.lpIds));
      case 'revert':
        if (!body.lpIds?.length) {
          return NextResponse.json({ error: 'Which notices?' }, { status: 400 });
        }
        return NextResponse.json(await revertNotices(callId, body.lpIds));
      case 'send':
        return NextResponse.json(await sendNotices(callId, body.lpIds));
      default:
        return NextResponse.json(
          { error: `Unknown action "${body.action ?? ''}".` },
          { status: 400 },
        );
    }
  } catch (e) {
    if (e instanceof ActionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Anything unexpected is logged server-side and reported plainly, rather
    // than leaking a database message to the browser.
    console.error('notice action failed', e);
    return NextResponse.json({ error: 'Something went wrong. Nothing was changed.' }, { status: 500 });
  }
}
