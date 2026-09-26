import { NextResponse } from 'next/server';
import { contentDisposition } from '@/server/content-disposition';
import { DownloadError, noticeFilesFor, noticeZipFor } from '@/server/notice-downloads';

/**
 * Notices as files.
 *
 *   GET .../notices/pdf?lpId=LP01   one investor's notice, as a PDF
 *   GET .../notices/pdf             every notice for the call, as a zip
 *   GET .../notices/pdf?lpId=LP01&lpId=LP04   those two, as a zip
 *
 * Rendering happens on the server for the same reason approving does: the
 * figures are recomputed from stored inputs, so nothing a browser sends can
 * change a number on the document.
 *
 * Node runtime, not edge — @react-pdf/renderer needs Node's Buffer and stream
 * handling, and the output is a Buffer.
 */
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;
  const lpIds = new URL(request.url).searchParams.getAll('lpId').filter(Boolean);

  try {
    // One named investor is the common case and gets a plain PDF; anything
    // else is a zip, including a single unnamed call with one investor on it.
    if (lpIds.length === 1) {
      const { files } = await noticeFilesFor(callId, lpIds);
      const [file] = files;
      return new NextResponse(new Uint8Array(file.pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': contentDisposition(file.fileName),
          'Cache-Control': 'no-store',
        },
      });
    }

    const { fileName, zip } = await noticeZipFor(callId, lpIds);
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition(fileName),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof DownloadError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Anything else is a bug here, not a bad request. Say so plainly rather
    // than handing back a corrupt file the browser would try to open.
    const message = e instanceof Error ? e.message : 'The notices could not be produced.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
