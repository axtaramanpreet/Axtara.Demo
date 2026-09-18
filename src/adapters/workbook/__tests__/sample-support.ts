/**
 * Shared plumbing for the sample workbooks in `samples/`.
 *
 * Each sample is defined by a test that lays out its tabs, asserts what the
 * engine makes of them, and writes the `.xlsx`. This module holds the parts
 * that are the same for every sample, so a change to how a sample is built or
 * verified happens once.
 *
 * Not a `.test.ts` file, so vitest treats it as a module rather than a suite.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { newModelFromTemplate } from '@/engine/fixtures/illustrative-fund';
import type { CallModel } from '@/engine/types';
import { parseWorkbook, type WorkbookLike, type WorkbookReader } from '../parse-workbook';

/** A spreadsheet row, as a flat list of cells. */
export type Row = (string | number)[];

/** A tab: its sheet name and its rows. */
export type Tab = readonly [name: string, rows: Row[]];

/** Assemble tabs into a workbook, in the order given. */
export function assemble(tabs: readonly Tab[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of tabs) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
}

/**
 * Parse exactly as the Set up screen does, including its baseline.
 *
 * The baseline is what makes this worth routing through: `parseWorkbook` layers
 * onto it field by field, so any tab a sample leaves blank inherits the
 * illustrative fund's value instead. Parsing against the same baseline the app
 * uses is what proves nothing leaks through.
 */
export function parseAsApp(wb: XLSX.WorkBook): CallModel {
  return parseWorkbook(
    XLSX as unknown as WorkbookReader,
    wb as unknown as WorkbookLike,
    newModelFromTemplate(),
  );
}

/** Read a committed sample back off disk, through the same parser. */
export function parseCommitted(path: string): CallModel {
  return parseAsApp(XLSX.read(readFileSync(path), { type: 'buffer' }));
}

/**
 * Write the sample to disk, but only when asked.
 *
 * Regenerating is opt-in so an ordinary test run never touches a committed
 * file: the tests that call this compare the committed sample against the
 * definition, and a run that rewrote the file first could never fail.
 */
export function publishIfRequested(path: string, wb: XLSX.WorkBook): void {
  if (!process.env.WRITE_SAMPLE) return;
  writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
