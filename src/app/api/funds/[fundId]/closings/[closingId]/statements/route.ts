import { NextResponse } from 'next/server';
import { ActionError } from '@/server/call-actions';
import { approveStatements, retryStatementDelivery, sendStatements } from '@/server/fund-actions';

/**
 * A closing's equalization statements: approve, send, or email again the ones
 * whose delivery failed. The body names the action and, optionally, the
 * investors — never an amount: every figure comes from the frozen equalization.
 * Approving also says the date the statements are payable by.
 */
export async function POST(request: Request, { params }: { params: Promise<{ fundId: string; closingId: string }> }) {
  const { fundId, closingId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string; lpIds?: string[]; paymentDueDate?: string };
  const lpIds = Array.isArray(body.lpIds) ? body.lpIds.map(String) : undefined;
  try {
    if (body.action === 'approve') return NextResponse.json(await approveStatements(fundId, closingId, lpIds, String(body.paymentDueDate ?? '')));
    if (body.action === 'send') return NextResponse.json(await sendStatements(fundId, closingId, lpIds));
    if (body.action === 'retry') return NextResponse.json(await retryStatementDelivery(fundId, closingId));
    return NextResponse.json({ error: 'Say whether to approve, send or retry.' }, { status: 400 });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('closing statements failed', e);
    return NextResponse.json({ error: 'Something went wrong. Nothing more was sent.' }, { status: 500 });
  }
}
