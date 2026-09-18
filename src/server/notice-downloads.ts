/**
 * Notices as downloadable files.
 *
 * Follows the same rule as approving and sending: the client says *which*
 * investor, never what they owe. The figures are recomputed here from stored
 * inputs, so a tampered request cannot change a single number on the document.
 *
 * A notice that has already been sent is rendered from its frozen snapshot
 * instead, so re-downloading one reproduces what the investor was told even if
 * the inputs have moved on since.
 */

import JSZip from 'jszip';
import { buildNotice, compute, type NoticeData } from '@/engine';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { SupabaseClient } from '@/adapters/storage/supabase-client';
import { getServerSupabase } from '@/lib/supabase/server';
import { noticeFileName, renderNoticePdf, type NoticeStatus } from './notice-pdf';

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One investor's notice, ready to write to a file. */
export interface NoticeFile {
  fileName: string;
  pdf: Buffer;
}

/**
 * Read the call as the signed-in user, so row-level security decides access.
 *
 * Downloading needs only read permission — unlike approving, it changes
 * nothing — so this deliberately does not check `auth_can_write_call`.
 */
async function loadReadable(callId: string) {
  const client = await getServerSupabase();

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new DownloadError('You are not signed in.', 401);

  const repo = createSupabaseRepository(client as unknown as SupabaseClient);
  const call = await repo.getCall(callId);
  if (!call) throw new DownloadError('That capital call could not be found.', 404);

  return { call, client };
}

/**
 * The frozen payloads of notices that have been sent, by investor id.
 *
 * Fetched here rather than carried on `NoticeState`, because a payload is a
 * whole notice per investor and every screen that lists calls would otherwise
 * pay for it.
 */
async function sentPayloads(
  client: Awaited<ReturnType<typeof getServerSupabase>>,
  callId: string,
): Promise<Map<string, NoticeData>> {
  const { data } = await client
    .from('notices')
    .select('investor_id, payload')
    .eq('call_id', callId)
    .eq('status', 'sent');

  const out = new Map<string, NoticeData>();
  for (const row of data ?? []) {
    if (row.payload) out.set(row.investor_id, row.payload as unknown as NoticeData);
  }
  return out;
}

/**
 * Build the PDFs for a call.
 *
 * @param callId The call to render.
 * @param lpIds  Which investors, or every active one when omitted.
 */
export async function noticeFilesFor(callId: string, lpIds?: string[]): Promise<{
  callNo: number;
  fundName: string;
  files: NoticeFile[];
}> {
  const { call, client } = await loadReadable(callId);
  const result = compute(call.model);

  const wanted = lpIds?.length ? new Set(lpIds) : null;
  const rows = result.rows.filter((r) => r.isActive && (!wanted || wanted.has(r.LP_ID)));

  if (wanted) {
    const missing = [...wanted].filter((id) => !rows.some((r) => r.LP_ID === id));
    if (missing.length) {
      throw new DownloadError(
        `Not on this call: ${missing.join(', ')}.`,
        404,
      );
    }
  }

  if (!rows.length) {
    throw new DownloadError('This call has no investors to produce notices for.', 404);
  }

  const frozen = rows.some(
    (r) => call.notices.find((n) => n.lpId === r.LP_ID)?.status === 'sent',
  )
    ? await sentPayloads(client, callId)
    : new Map<string, NoticeData>();

  const files: NoticeFile[] = [];

  for (const row of rows) {
    const state = call.notices.find((n) => n.lpId === row.LP_ID);
    const status: NoticeStatus = state?.status ?? 'draft';

    // A sent notice is reproduced from the snapshot taken when it went out.
    // Re-deriving it would quietly hand back today's figures under the same
    // letterhead, which is the one thing an issued notice must never do.
    const snapshot = state ? frozen.get(state.investorId) : undefined;
    const notice: NoticeData =
      status === 'sent' && snapshot ? snapshot : buildNotice(call.model, result, row);

    files.push({
      fileName: noticeFileName(call.callNo, String(row.LP_Name ?? row.LP_ID)),
      pdf: await renderNoticePdf(notice, status, state?.sentAt ?? null),
    });
  }

  return { callNo: call.callNo, fundName: String(call.model.setup.Fund_Name ?? ''), files };
}

/** Every notice for a call, as one zip. */
export async function noticeZipFor(
  callId: string,
  lpIds?: string[],
): Promise<{ fileName: string; zip: Buffer }> {
  const { callNo, files } = await noticeFilesFor(callId, lpIds);

  const zip = new JSZip();
  // Two investors can legitimately share a name — a nominee and its underlying
  // vehicle, say — and a duplicate entry would silently overwrite the first.
  const used = new Map<string, number>();
  for (const file of files) {
    const seen = used.get(file.fileName) ?? 0;
    used.set(file.fileName, seen + 1);
    const name = seen === 0 ? file.fileName : file.fileName.replace(/\.pdf$/, ` (${seen + 1}).pdf`);
    zip.file(name, file.pdf);
  }

  return {
    fileName: `Capital Call #${callNo} — notices.zip`,
    zip: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  };
}
