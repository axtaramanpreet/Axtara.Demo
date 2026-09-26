/**
 * Every template, filled in the way a person fills a spreadsheet, and read back.
 *
 * Built, written to bytes and read again with the real SheetJS, so what is
 * tested is the file someone downloads — not the rows before they were written.
 */

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { BLANK_TERMS, type FundTerms } from '@/engine';
import { ILLUSTRATIVE_FUND } from '@/engine/fixtures/illustrative-fund';
import { parseWorkbook, type WorkbookReader } from '../parse-workbook';
import {
  INVESTORS_SHEET,
  investorsTemplate,
  readInvestorsTemplate,
  COMMITMENTS_SHEET,
  TERMS_SHEET,
  callTemplate,
  commitmentsTemplate,
  readCommitmentsTemplate,
  readTermsTemplate,
  termsTemplate,
  type Book,
} from '../templates';
import { emptyCall } from '@/engine';

const W = XLSX as unknown as Parameters<typeof termsTemplate>[0];

/** Write to bytes and read back, as a download and an upload would. */
function roundTrip(book: Book) {
  const bytes = XLSX.write(book as XLSX.WorkBook, { type: 'array', bookType: 'xlsx' });
  return XLSX.read(bytes, { type: 'array' });
}
const grid = (wb: XLSX.WorkBook, name: string) =>
  wb.Sheets[name] ? (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) as unknown[][]) : null;

/** Fill a Field/Value sheet the way a person would: by the label in column A. */
function fill(wb: XLSX.WorkBook, sheet: string, values: Record<string, unknown>) {
  const rows = grid(wb, sheet)!;
  for (const [label, value] of Object.entries(values)) {
    const r = rows.findIndex((row) => row[0] === label);
    if (r < 0) throw new Error(`No row labelled ${label}`);
    wb.Sheets[sheet][XLSX.utils.encode_cell({ r, c: 1 })] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) };
  }
  return roundTrip(wb as unknown as Book);
}

describe('the fund terms template', () => {
  it('reads what a person writes: "2%", "Quarterly", "Yes", an Excel date', () => {
    const wb = fill(roundTrip(termsTemplate(W, 'Fund III', null)), TERMS_SHEET, {
      'Applies from': 46037, // Excel's serial for 2026-01-15
      'Reporting currency': 'usd',
      'Annual rate': '2%',
      'How often': 'Quarterly',
      'Billed': 'In advance',
      'Days counted as': 'Exact days ÷ 365',
      'Counts against commitment': 'Yes',
      'Interest on catching up': 0.08,
      'Interest goes to': 'The fund',
      'After the investment period: charged on': 'Invested capital',
      'After the investment period: annual rate': '1.5%',
    });
    const r = readTermsTemplate(grid(wb, TERMS_SHEET));
    expect(r.errors).toEqual([]);
    expect(r.effectiveFrom).toBe('2026-01-15');
    expect(r.draft).toMatchObject({
      reportingCurrency: 'USD',
      feeRateAnnual: '2%',
      feePeriodFraction: '0.25',
      feeTiming: 'advance',
      feeDayCount: 'actual_365',
      feeReducesUnfunded: 'Y',
      lateCloseInterestRate: '8%',
      equalizationInterestTo: 'fund',
    });
    expect(r.afterIp).toEqual({ basis: 'Invested_Capital', rate: '1.5%' });
  });

  it('names every value it cannot read, and refuses a bare 2 as a rate', () => {
    const wb = fill(roundTrip(termsTemplate(W, 'Fund III', null)), TERMS_SHEET, { 'Annual rate': 2, 'How often': 'Fortnightly' });
    const r = readTermsTemplate(grid(wb, TERMS_SHEET));
    expect(r.errors).toEqual(['Annual rate: Write 2% (or 0.02) for two percent.', 'How often: One of: Quarterly, Half-yearly, Yearly.']);
    expect(r.draft.feeRateAnnual).toBeUndefined();
  });

  it('comes pre-filled with the terms in force, and reads back the same', () => {
    const inForce: FundTerms = { ...BLANK_TERMS, effectiveFrom: '2026-01-15', createdAt: '', feeRateAnnual: 0.02, feeBasis: 'Invested_Capital', feePeriodFraction: 0.5, feeExemptLpIds: ['GP01'] };
    const r = readTermsTemplate(grid(roundTrip(termsTemplate(W, 'Fund III', inForce)), TERMS_SHEET));
    expect(r.draft).toMatchObject({ feeRateAnnual: '2%', feeBasis: 'Invested_Capital', feePeriodFraction: '0.5', feeExemptLpIds: 'GP01' });
  });

  it('says so when the file is not a terms template', () => {
    expect(readTermsTemplate(null).errors[0]).toMatch(/no Fund_Terms sheet/);
  });
});

describe('the commitments template', () => {
  const filled = (rows: unknown[][]) => {
    const wb = roundTrip(commitmentsTemplate(W, 'Fund III', 1));
    XLSX.utils.sheet_add_aoa(wb.Sheets[COMMITMENTS_SHEET], rows, { origin: 'A2' });
    return readCommitmentsTemplate(grid(roundTrip(wb as unknown as Book), COMMITMENTS_SHEET));
  };

  it('reads each investor, with a side letter and an exemption', () => {
    const r = filled([
      ['LP01', 'Alpha Pension Trust', 25_000_000, '', '', 'ops@alpha.example'],
      ['LP03', 'Aster Family Office', '10,000,000', '1.5%', 'No', ''],
      ['GP01', 'Fund GP LLC', 2_500_000, '', 'Yes', ''],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((k) => [k.lpId, k.amount, k.feeRateOverride, k.feeExempt, k.contactEmail])).toEqual([
      ['LP01', 25_000_000, null, false, 'ops@alpha.example'],
      ['LP03', 10_000_000, 0.015, false, null],
      ['GP01', 2_500_000, null, true, null],
    ]);
  });

  it('names every row it cannot read, and keeps the rest', () => {
    const r = filled([
      ['LP01', 'Alpha', 25_000_000],
      ['LP01', 'Alpha again', 1],
      ['', 'No ID', 5_000_000],
      ['LP04', 'Kestrel', 0, '15'],
    ]);
    expect(r.rows.map((k) => k.lpId)).toEqual(['LP01']);
    expect(r.errors).toEqual([
      'Row 3 (LP01): LP01 is listed twice.',
      'Row 4: no LP_ID.',
      'Row 5 (LP04): the commitment must be an amount above zero; side-letter fee rate: Write 2% (or 0.02) for two percent.',
    ]);
  });
});

describe('the capital call template', () => {
  it('reads back through the call workbook parser exactly as it was written', () => {
    const model = structuredClone(ILLUSTRATIVE_FUND);
    const read = parseWorkbook(XLSX as unknown as WorkbookReader, roundTrip(callTemplate(W, model)), emptyCall('Fund III'));
    expect(read.lps.map((l) => [l.LP_ID, l.Commitment, l.Opening_Paid_In, l.Opening_UCC])).toEqual(
      model.lps.map((l) => [l.LP_ID, l.Commitment, l.Opening_Paid_In, l.Opening_UCC]),
    );
    expect(read.components.map((c) => [c.Component_ID, c.Total_Amount, c.Category])).toEqual(
      model.components.map((c) => [c.Component_ID, c.Total_Amount, c.Category]),
    );
    expect(read.setup.Call_Date).toBe(model.setup.Call_Date);
    expect(read.fee.offsets?.length).toBe(model.fee.offsets?.length);
  });
});

describe('the investor register template', () => {
  const TYPES = ['Pension', 'Endowment', 'General partner'];
  const KYC = { not_started: 'Not started', in_progress: 'In progress', approved: 'Approved', expired: 'Expired' } as const;
  const filled = (rows: unknown[][]) => {
    const wb = roundTrip(investorsTemplate(W, 'Fund III', TYPES, Object.values(KYC)));
    XLSX.utils.sheet_add_aoa(wb.Sheets[INVESTORS_SHEET], rows, { origin: 'A2' });
    return readInvestorsTemplate(grid(roundTrip(wb as unknown as Book), INVESTORS_SHEET), TYPES, KYC);
  };

  it('reads each investor, in the words a person writes', () => {
    const r = filled([
      ['LP01', 'Alpha Pension Trust', 'pension', 'Canada', 'ops@alpha.example', 'cfo@alpha.example, ir@alpha.example', '', 'approved'],
      ['GP01', 'Fund GP LLC', 'General partner', 'USA', '', '', 'Yes', ''],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { lpId: 'LP01', name: 'Alpha Pension Trust', type: 'Pension', country: 'Canada', email: 'ops@alpha.example', ccEmails: ['cfo@alpha.example', 'ir@alpha.example'], isGp: false, kycStatus: 'approved' },
      { lpId: 'GP01', name: 'Fund GP LLC', type: 'General partner', country: 'USA', email: null, ccEmails: [], isGp: true, kycStatus: 'not_started' },
    ]);
  });

  it('names every row it cannot read', () => {
    const r = filled([
      ['LP01', 'Alpha', 'Hedge fund', '', 'not-an-email'],
      ['LP02', '', '', '', '', '', 'maybe', 'Pending'],
    ]);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([
      'Row 2 (LP01): type: one of Pension, Endowment, General partner; notices email "not-an-email" is not an address.',
      'Row 3 (LP02): no legal name; general partner: Yes or No; KYC: one of Not started, In progress, Approved, Expired.',
    ]);
  });
});
