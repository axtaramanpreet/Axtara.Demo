import { NextResponse } from 'next/server';
import { ActionError } from '@/server/call-actions';
import { contentDisposition } from '@/server/content-disposition';
import { statementFor } from '@/server/fund-actions';

/**
 * One investor's equalization statement, as a PDF.
 *
 *   GET .../closings/{closingId}/statement?lpId=LP07
 *
 * The figures come from the record, not the request: frozen for a finalised
 * closing, worked out now for a draft.
 */
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fundId: string; closingId: string }> },
) {
  const { fundId, closingId } = await params;
  const lpId = new URL(request.url).searchParams.get('lpId');
  if (!lpId) return NextResponse.json({ error: 'Say which investor: ?lpId=' }, { status: 400 });

  try {
    const { pdf, fileName } = await statementFor(fundId, closingId, lpId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(fileName),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('equalization statement failed', e);
    return NextResponse.json({ error: 'Something went wrong. The statement was not produced.' }, { status: 500 });
  }
}
