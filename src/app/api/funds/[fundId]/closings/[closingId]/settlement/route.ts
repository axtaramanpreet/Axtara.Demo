import { NextResponse } from 'next/server';
import { ActionError } from '@/server/call-actions';
import { setClosingSettlement } from '@/server/fund-actions';
import type { Settlement } from '@/engine';

/**
 * Choose, or change, how a finalised closing's equalization is settled:
 * statements now, or on the next capital call. No figure changes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ fundId: string; closingId: string }> }) {
  const { fundId, closingId } = await params;
  const body = (await request.json().catch(() => ({}))) as { settlement?: Settlement };
  if (!body.settlement) return NextResponse.json({ error: 'Say how the equalization is settled.' }, { status: 400 });
  try {
    return NextResponse.json(await setClosingSettlement(fundId, closingId, body.settlement));
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('choose closing settlement failed', e);
    return NextResponse.json({ error: 'Something went wrong. Nothing was changed.' }, { status: 500 });
  }
}
