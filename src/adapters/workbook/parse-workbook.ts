/**
 * Reads the accountant's input workbook into a `CallModel`.
 *
 * The template has one tab per part of the model — Fund_Setup, LP_Register,
 * Call_Components, Management_Fee, Transfers, Expected_Output — laid out as
 * either a key/value list or a table under a header row. Tabs the workbook
 * omits keep the values already in the model, so a partially-filled workbook
 * degrades to sensible defaults rather than blanking the call.
 *
 * SheetJS is injected rather than imported so this module stays testable and so
 * the (large) parser can be code-split away from pages that never parse a file.
 */

import type { CallModel, FeeConfig, GoldenRow, TransferRow } from '@/engine/types';
import { FEE_FIELD_KEYS } from './template-layout';

/** A worksheet read as a raw grid of cells. */
type Grid = unknown[][];

/** The subset of the SheetJS API this adapter needs. */
export interface WorkbookReader {
  utils: {
    sheet_to_json: (sheet: unknown, opts: { header: 1; raw: true; defval: '' }) => Grid;
  };
}

export interface WorkbookLike {
  Sheets: Record<string, unknown>;
}

/**
 * Parse a workbook that follows the template's tab layout.
 *
 * @param XLSX     The SheetJS module (or anything with the same `sheet_to_json`).
 * @param wb       The workbook to read.
 * @param baseline The model to layer parsed values onto — normally a fresh copy
 *                 of the illustrative template, so unfilled tabs keep defaults.
 */
export function parseWorkbook(
  XLSX: WorkbookReader,
  wb: WorkbookLike,
  baseline: CallModel,
): CallModel {
  const grid = (name: string): Grid | null =>
    wb.Sheets[name]
      ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })
      : null;

  const model: CallModel = structuredClone(baseline);

  // --- Fund_Setup: a Field/Value list -------------------------------------
  const setup = readKeyValues(grid('Fund_Setup'));
  if (Object.keys(setup).length) {
    Object.assign(model.setup, setup);
    model.setup.Call_Date = normaliseDate(model.setup.Call_Date);
    model.setup.Payment_Due_Date = normaliseDate(model.setup.Payment_Due_Date);
  }

  // --- LP_Register / Call_Components: tables ------------------------------
  const lps = readTable(grid('LP_Register'), 'LP_ID');
  if (lps.length) model.lps = lps as CallModel['lps'];

  const components = readTable(grid('Call_Components'), 'Component_ID');
  if (components.length) model.components = components as CallModel['components'];

  // --- Management_Fee: a Field/Value list plus an Offsets table ------------
  const feeGrid = grid('Management_Fee');
  if (feeGrid) {
    const all = readKeyValues(feeGrid);
    const picked: Record<string, unknown> = {};
    FEE_FIELD_KEYS.forEach((key) => {
      if (key in all) picked[key] = all[key];
    });
    model.fee = {
      ...model.fee,
      ...picked,
      offsets: readTable(feeGrid, 'Offset_ID') as FeeConfig['offsets'],
    } as FeeConfig;
  }

  // --- Transfers ----------------------------------------------------------
  const transferGrid = grid('Transfers');
  if (transferGrid) {
    model.transfers = (readTable(transferGrid, 'Transfer_ID') as TransferRow[]).map((t) => ({
      ...t,
      Effective_Date: normaliseDate(t.Effective_Date),
    }));
  }

  // --- Expected_Output: the regression fixture ----------------------------
  // The tab ends with a TOTAL row, but its LP_ID cell is blank, so the table
  // reader stops there of its own accord.
  const golden = readTable(grid('Expected_Output'), 'LP_ID') as GoldenRow[];
  model.golden = golden.length ? golden : null;
  model.goldenSource = golden.length ? 'uploaded workbook · Expected_Output' : '';

  return model;
}

/**
 * Read a `Field | Value` list into an object.
 *
 * Skips the header row and any row with a blank value, so half-filled template
 * rows do not overwrite good defaults with empty strings.
 */
function readKeyValues(g: Grid | null): Record<string, never> {
  const out: Record<string, unknown> = {};
  (g || []).forEach((row) => {
    const key = row[0];
    if (typeof key === 'string' && key && key !== 'Field' && row[1] !== '') {
      out[key] = row[1];
    }
  });
  return out as Record<string, never>;
}

/**
 * Read a table that starts at the row whose first cell is `headerKey`.
 *
 * Stops at the first row with a blank first cell, which is how every table in
 * the template ends. Columns are taken from the header row, so a workbook
 * carrying extra columns keeps them.
 *
 * Note the order: columns are paired with their values by position *before*
 * blank headers are dropped. Pairing after dropping would shift every column
 * following a blank one, quietly filing (say) commitments under paid-in.
 */
function readTable(g: Grid | null, headerKey: string): Record<string, unknown>[] {
  if (!g) return [];

  const headerIndex = g.findIndex((row) => row[0] === headerKey);
  if (headerIndex < 0) return [];

  const header = g[headerIndex];
  const out: Record<string, unknown>[] = [];

  for (const row of g.slice(headerIndex + 1)) {
    if (row[0] === '' || row[0] == null) break;
    out.push(
      Object.fromEntries(
        header
          .map((k, i) => [k, row[i] ?? ''] as const)
          .filter(([k]) => Boolean(k)),
      ),
    );
  }

  return out;
}

/** Excel serial dates come through as numbers; normalise them to `YYYY-MM-DD`. */
export function normaliseDate(v: unknown): string | number {
  if (typeof v === 'number') {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return v as string;
}
