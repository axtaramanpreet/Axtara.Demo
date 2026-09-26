import { NextResponse } from 'next/server';
import { ActionError } from '@/server/call-actions';
import { finaliseClosing } from '@/server/fund-actions';
import type { Settlement } from '@/engine';

/**
 * Finalise a closing: freeze its equalization and fix who it admitted.
 *
 * The body carries only how the equalization is settled. Every figure is
 * recomputed on the server from the record, so nothing a browser sends can
 * change what an investor owes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ fundId: string; closingId: string }> }) {
  const { fundId, closingId } = await params;
  const body = (await request.json().catch(() => ({}))) as { settlement?: Settlement | null };
  try {
    return NextResponse.json(await finaliseClosing(fundId, closingId, { settlement: body.settlement ?? null }));
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('finalise closing failed', e);
    return NextResponse.json({ error: 'Something went wrong. The closing was not finalised.' }, { status: 500 });
  }
}
