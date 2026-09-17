/**
 * Round-trips the real input template through the parser and the engine.
 *
 * This guards the path an accountant actually takes on day one: open the app,
 * upload the workbook the firm already uses, and expect it to come back clean.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { compute } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { parseWorkbook, type WorkbookLike, type WorkbookReader } from '../parse-workbook';
import { parseWorkbook as parseOriginal } from '../../../../design_handoff_capital_call_engine 2/defaults.js';

const WORKBOOK_PATH = fileURLToPath(
  new URL(
    '../../../../design_handoff_capital_call_engine 2/uploads/capcall_input.xlsx',
    import.meta.url,
  ),
);

function loadTemplateWorkbook() {
  const wb = XLSX.read(readFileSync(WORKBOOK_PATH), { type: 'buffer' });
  return parseWorkbook(XLSX as unknown as WorkbookReader, wb as WorkbookLike, ILLUSTRATIVE_FUND);
}

describe('parseWorkbook on the shipped input template', () => {
  const model = loadTemplateWorkbook();

  it('reads every investor from LP_Register', () => {
    expect(model.lps.map((l) => l.LP_ID)).toEqual(['LP01', 'LP02', 'LP03', 'LP04', 'LP05', 'GP01']);
  });

  it('reads every call component', () => {
    expect(model.components.map((c) => c.Component_ID)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('reads the fee configuration and its offsets', () => {
    expect(model.fee.Fee_Basis).toBe('Commitment');
    expect(model.fee.offsets?.map((o) => o.Offset_ID)).toEqual(['O1']);
  });

  it('reads transfers and normalises their dates', () => {
    expect(model.transfers.map((t) => t.Transfer_ID)).toEqual(['T1']);
    expect(model.transfers[0].Effective_Date).toBe('2026-12-31');
  });

  it('normalises the call and due dates to ISO', () => {
    expect(model.setup.Call_Date).toBe('2026-09-30');
    expect(model.setup.Payment_Due_Date).toBe('2026-10-14');
  });

  /**
   * The Expected_Output tab ends with a TOTAL row. It must not be read as a
   * seventh investor: the engine could match it to nobody, and a workbook that
   * is actually correct would report a failing Expected_Output check on the very
   * first thing an accountant does.
   */
  it('stops at the totals row rather than reading it as an investor', () => {
    expect(model.golden?.map((g) => g.LP_ID)).toEqual([
      'LP01',
      'LP02',
      'LP03',
      'LP04',
      'LP05',
      'GP01',
    ]);
  });

  it('computes the uploaded workbook with no differences and no failures', () => {
    const result = compute(model);
    expect(result.goldenDiffs).toEqual([]);
    expect(result.checks.filter((c) => c.level === 'fail')).toEqual([]);
    expect(result.checks.find((c) => c.text.startsWith('Expected_Output fixture'))?.level).toBe(
      'ok',
    );
  });

  it('agrees with the hand-transcribed fixture to the cent', () => {
    const fromWorkbook = compute(model);
    const fromFixture = compute(ILLUSTRATIVE_FUND);
    expect(fromWorkbook.totals.total).toBeCloseTo(fromFixture.totals.total, 2);
    expect(fromWorkbook.rows.map((r) => r.total)).toEqual(fromFixture.rows.map((r) => r.total));
  });

  /**
   * Held against the original handoff parser for the same reason as the engine:
   * this one was rewritten for clarity, so it has to be shown to read the
   * workbook identically rather than merely plausibly.
   */
  it('reads the workbook identically to the original handoff parser', () => {
    const original = parseOriginal(
      XLSX,
      XLSX.read(readFileSync(WORKBOOK_PATH), { type: 'buffer' }),
    );
    expect(model.lps).toEqual(original.lps);
    expect(model.components).toEqual(original.components);
    expect(model.transfers).toEqual(original.transfers);
    expect(model.fee).toEqual(original.fee);
    expect(model.golden).toEqual(original.golden);
    expect(model.setup).toEqual(original.setup);
  });
});
