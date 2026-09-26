/**
 * Templates anyone can fill in, one per step that takes input: the fund's
 * terms, a closing's commitments, and a capital call.
 *
 * Each is built from the same field lists its screen uses, so a template can
 * never ask for something the screen does not know, or miss something it does.
 * Reading one back only fills that screen's form: nothing is recorded until
 * someone looks at it and presses Record or Save.
 *
 * Spreadsheets arrive as people write them, so reading is forgiving where it
 * can be — "2%" or 0.02, "Quarterly", "Yes", an Excel date — and names every
 * row it cannot read rather than skipping it quietly.
 *
 * SheetJS is passed in, as in `parse-workbook.ts`, so these stay testable and
 * the library stays out of pages that never touch a file.
 */

import type { ClosingCommitmentInput } from '@/adapters/storage/types';
import type { CallModel, FundTerms } from '@/engine';
import { FIELD, FIELDS, GROUPS, fromDraft, toDraft, type Field, type TermKey } from '@/lib/fund-terms-fields';
import { normaliseDate } from './parse-workbook';
import { COMPONENT_COLUMNS, FEE_FIELDS, LP_COLUMNS, OFFSET_COLUMNS, SETUP_FIELDS, TRANSFER_COLUMNS } from './template-layout';

type Grid = unknown[][];

/** The parts of SheetJS used to build a workbook. */
export interface WorkbookWriter {
  utils: {
    aoa_to_sheet: (rows: unknown[][]) => unknown;
    book_new: () => { SheetNames: string[]; Sheets: Record<string, unknown> };
    book_append_sheet: (book: { SheetNames: string[]; Sheets: Record<string, unknown> }, sheet: unknown, name: string) => void;
  };
}

export type Book = ReturnType<WorkbookWriter['utils']['book_new']>;

function book(XLSX: WorkbookWriter, sheets: [string, unknown[][]][]): Book {
  const b = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(rows), name);
  return b;
}

const text = (v: unknown) => String(v ?? '').trim();
const isDateKey = (key: string) => FIELD[key as TermKey]?.kind === 'date';

// --- Fund terms -------------------------------------------------------------

export const TERMS_SHEET = 'Fund_Terms';
const TERMS_HEADER = ['Field', 'Value', 'What it means', 'What to write', 'Code'];

/** Rows that are not fund terms but belong to the same record. */
const EXTRA = {
  effectiveFrom: { label: 'Applies from', means: 'The first day these terms apply. For a new fund: the date of the LPA or the first close, no later.', accepts: 'A date, e.g. 2026-01-15' },
  afterIpBasis: { label: 'After the investment period: charged on', means: 'What the fee is charged on once the investment period ends, if the LPA changes it. Blank for no change.', accepts: 'Commitment, Invested capital or NAV' },
  afterIpRate: { label: 'After the investment period: annual rate', means: 'The fee rate once the investment period ends. Needed with the line above.', accepts: 'A rate, e.g. 1.5%' },
  note: { label: 'Note', means: 'Why these terms, and where they come from: a clause of the LPA, a side letter.', accepts: 'Anything' },
} as const;

function accepts(f: Field): string {
  switch (f.kind) {
    case 'rate':
      return 'A rate, e.g. 2% or 0.02. Blank for none.';
    case 'select':
      return `One of: ${f.options?.map((o) => o.label).join(', ')}`;
    case 'yesno':
      return 'Yes or No';
    case 'date':
      return 'A date, e.g. 2031-01-14';
    case 'currency':
      return 'A currency code, e.g. USD';
    case 'int':
      return 'A whole number, 0 to 4';
    case 'money':
      return 'An amount, e.g. 1500000';
    case 'investor':
      return 'One investor ID, e.g. LP04';
    case 'investors':
      return 'Investor IDs, separated by commas';
    default:
      return 'Text';
  }
}

/** The terms template, pre-filled with the terms in force when there are any. */
export function termsTemplate(XLSX: WorkbookWriter, fundName: string, inForce: FundTerms | null): Book {
  const rows: unknown[][] = [
    [`${fundName} — fund terms`],
    ['Fill in the Value column from the LPA, then import this file on the Fund terms page. Nothing is recorded until you check it and press Record.'],
    [],
    TERMS_HEADER,
    [EXTRA.effectiveFrom.label, '', EXTRA.effectiveFrom.means, EXTRA.effectiveFrom.accepts, 'effectiveFrom'],
  ];
  for (const group of GROUPS) {
    rows.push([], [group.title]);
    for (const f of group.fields) {
      const value = inForce ? toDraft(f, inForce[f.key]) : '';
      const shown = f.kind === 'select' && value ? (f.options?.find((o) => o.value === value)?.label ?? value) : f.kind === 'yesno' && value ? (value === 'Y' ? 'Yes' : 'No') : value;
      rows.push([f.label, shown, f.info, accepts(f), f.key]);
    }
    if (group.id === 'fee') {
      for (const k of ['afterIpBasis', 'afterIpRate'] as const) rows.push([EXTRA[k].label, '', EXTRA[k].means, EXTRA[k].accepts, k]);
    }
  }
  rows.push([], [EXTRA.note.label, '', EXTRA.note.means, EXTRA.note.accepts, 'note']);
  return book(XLSX, [[TERMS_SHEET, rows]]);
}

export interface TermsImport {
  effectiveFrom: string | null;
  /** Each term as the form holds it. Only terms the file filled in. */
  draft: Partial<Record<TermKey, string>>;
  afterIp: { basis: string; rate: string } | null;
  note: string | null;
  /** Every value that could not be read, by its label. */
  errors: string[];
}

/** Read a filled-in terms template back into the form's terms. */
export function readTermsTemplate(grid: Grid | null): TermsImport {
  const out: TermsImport = { effectiveFrom: null, draft: {}, afterIp: null, note: null, errors: [] };
  if (!grid) {
    out.errors.push(`This file has no ${TERMS_SHEET} sheet. Start from the template on the Fund terms page.`);
    return out;
  }
  const byLabel = new Map<string, string>([...FIELDS.map((f) => [f.label.toLowerCase(), f.key] as const), ...Object.entries(EXTRA).map(([k, v]) => [v.label.toLowerCase(), k] as const)]);
  let afterBasis = '';
  let afterRate = '';
  for (const row of grid) {
    const code = text(row[4]) || byLabel.get(text(row[0]).toLowerCase()) || '';
    const raw = isDateKey(code) || code === 'effectiveFrom' ? normaliseDate(row[1]) : row[1];
    const value = text(raw);
    if (!code || !value) continue;
    if (code === 'effectiveFrom') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) out.effectiveFrom = value;
      else out.errors.push(`Applies from: a date, like 2026-01-15.`);
    } else if (code === 'note') out.note = value;
    else if (code === 'afterIpBasis') afterBasis = value;
    else if (code === 'afterIpRate') afterRate = value;
    else if (code in FIELD) {
      const f = FIELD[code as TermKey];
      const r = fromDraft(f, value);
      if ('error' in r) out.errors.push(`${f.label}: ${r.error}`);
      else out.draft[f.key] = toDraft(f, r.value as never);
    }
  }
  if (afterBasis || afterRate) {
    const basis = fromDraft(FIELD.feeBasis, afterBasis);
    if ('error' in basis) out.errors.push(`${EXTRA.afterIpBasis.label}: ${basis.error}`);
    out.afterIp = { basis: 'value' in basis && basis.value ? String(basis.value) : 'Invested_Capital', rate: afterRate };
  }
  return out;
}

// --- Closing commitments ----------------------------------------------------

export const COMMITMENTS_SHEET = 'Commitments';
const COMMITMENT_HEADER = ['LP_ID', 'Investor name', 'Commitment', 'Side-letter fee rate', 'Fee exempt', 'Contact email'];

/** The commitments template: one row per investor, with a sheet saying what goes where. */
export function commitmentsTemplate(XLSX: WorkbookWriter, fundName: string, closingNo: number): Book {
  return book(XLSX, [
    [COMMITMENTS_SHEET, [COMMITMENT_HEADER]],
    [
      'Instructions',
      [
        [`${fundName} — Closing ${closingNo} commitments`],
        [],
        ['Column', 'What to write'],
        ['LP_ID', 'A short ID you choose, e.g. LP01. Use the same ID for the same investor at every closing.'],
        ['Investor name', 'Their legal name, as it should appear on notices.'],
        ['Commitment', 'What they commit at this closing, e.g. 25000000. An existing investor increasing: just the increase.'],
        ['Side-letter fee rate', 'Only if a side letter sets a different management fee, e.g. 1.5%. Blank for the fund’s rate.'],
        ['Fee exempt', 'Yes if they pay no management fee at all, usually the general partner. Blank means No.'],
        ['Contact email', 'Where their notices go.'],
        [],
        ['Fill in the Commitments sheet, one investor per row, then import it on the draft closing. Nothing is saved until you press Save.'],
      ],
    ],
  ]);
}

/** Read a filled-in commitments template: the rows it can read, and every row it cannot. */
export function readCommitmentsTemplate(grid: Grid | null): { rows: ClosingCommitmentInput[]; errors: string[] } {
  const rows: ClosingCommitmentInput[] = [];
  const errors: string[] = [];
  if (!grid) return { rows, errors: [`This file has no ${COMMITMENTS_SHEET} sheet. Start from the template on the closing.`] };
  const headerAt = grid.findIndex((r) => text(r[0]) === 'LP_ID');
  if (headerAt < 0) return { rows, errors: [`The ${COMMITMENTS_SHEET} sheet has no LP_ID header row.`] };
  const seen = new Set<string>();
  grid.slice(headerAt + 1).forEach((r, i) => {
    const at = `Row ${headerAt + i + 2}`;
    const lpId = text(r[0]);
    if (!lpId && !text(r[1]) && !text(r[2])) return;
    const name = text(r[1]);
    const amount = Number(text(r[2]).replace(/[,\s]/g, ''));
    const problems: string[] = [];
    if (!lpId) problems.push('no LP_ID');
    else if (seen.has(lpId)) problems.push(`${lpId} is listed twice`);
    if (!name) problems.push('no investor name');
    if (!Number.isFinite(amount) || amount <= 0) problems.push('the commitment must be an amount above zero');
    const rate = fromDraft(FIELD.feeRateAnnual, r[3]);
    if ('error' in rate) problems.push(`side-letter fee rate: ${rate.error.replace(/\.$/, '')}`);
    const exempt = text(r[4]) ? fromDraft({ ...FIELD.feeReducesUnfunded, label: 'Fee exempt' }, r[4]) : { value: false };
    if ('error' in exempt) problems.push('fee exempt: Yes or No');
    if (problems.length) {
      errors.push(`${at}${lpId ? ` (${lpId})` : ''}: ${problems.join('; ')}.`);
      return;
    }
    seen.add(lpId);
    rows.push({
      lpId,
      name,
      amount,
      feeRateOverride: 'value' in rate && rate.value ? (rate.value as number) : null,
      feeExempt: 'value' in exempt ? Boolean(exempt.value) : false,
      contactEmail: text(r[5]) || null,
    });
  });
  return { rows, errors };
}

// --- Capital call -----------------------------------------------------------

/**
 * The call input workbook, in the layout `parseWorkbook` reads, pre-filled
 * with what the call already has — its fund-level fields from the terms, and
 * its register from the fund's investors — so only what is being called for
 * is left to fill in.
 */
export function callTemplate(XLSX: WorkbookWriter, model: CallModel): Book {
  const kv = (fields: { key: string; note: string }[], values: Record<string, unknown>) => [
    ['Field', 'Value', 'Notes'],
    ...fields.map((f) => [f.key, values[f.key] ?? '', f.note]),
  ];
  const table = (columns: { key: string }[], rows: Record<string, unknown>[]) => [
    columns.map((c) => c.key),
    ...rows.map((r) => columns.map((c) => r[c.key] ?? '')),
  ];
  return book(XLSX, [
    ['Fund_Setup', kv(SETUP_FIELDS, model.setup)],
    ['LP_Register', table(LP_COLUMNS, model.lps)],
    ['Call_Components', table(COMPONENT_COLUMNS, model.components)],
    ['Management_Fee', [...kv(FEE_FIELDS, model.fee as unknown as Record<string, unknown>), [], ...table(OFFSET_COLUMNS, model.fee.offsets ?? [])]],
    ['Transfers', table(TRANSFER_COLUMNS, model.transfers)],
    [
      'Instructions',
      [
        ['Capital call input workbook'],
        [],
        ['Fund_Setup', 'The call’s dates. Fields from the fund’s terms are already filled in and follow the terms on import.'],
        ['LP_Register', 'Every investor and their balances before this call. Filled in from the fund’s record; change it only to correct it.'],
        ['Call_Components', 'What is being called for: one row per deal or expense. Category: Deal, Partnership Expense or Organizational Expense.'],
        ['Management_Fee', 'The fee for this call, and any offsets against it.'],
        ['Transfers', 'Only if an investor transfers part or all of their interest at this call.'],
        [],
        ['Upload this file on the call’s Source step. Nothing is issued until the call is reviewed, approved and sent.'],
      ],
    ],
  ]);
}

// --- Investors --------------------------------------------------------------

export const INVESTORS_SHEET = 'Investors';
const INVESTOR_HEADER = ['LP_ID', 'Legal name', 'Type', 'Country', 'Notices email', 'Copies to', 'General partner', 'KYC'];

/** The investor register template: one row per investor, as they are onboarded. */
export function investorsTemplate(XLSX: WorkbookWriter, fundName: string, types: string[], kyc: string[]): Book {
  return book(XLSX, [
    [INVESTORS_SHEET, [INVESTOR_HEADER]],
    [
      'Instructions',
      [
        [`${fundName} — investor register`],
        [],
        ['Column', 'What to write'],
        ['LP_ID', 'A short ID you choose, e.g. LP01. The same investor keeps it at every closing and call.'],
        ['Legal name', 'As it should appear on notices and statements.'],
        ['Type', `One of: ${types.join(', ')}.`],
        ['Country', 'Where the investor is domiciled.'],
        ['Notices email', 'The address every capital call notice is sent to.'],
        ['Copies to', 'Anyone else who gets a copy of each notice, separated by commas.'],
        ['General partner', 'Yes for the general partner’s own commitment. Blank means No.'],
        ['KYC', `One of: ${kyc.join(', ')}. Blank means Not started.`],
        [],
        ['Commitments are not recorded here: they come from the closing that admits each investor.'],
        ['Import this file on the Investors page. You will see what it adds and changes before anything is saved.'],
      ],
    ],
  ]);
}

export interface InvestorImportRow {
  lpId: string;
  name: string;
  type: string;
  country: string | null;
  email: string | null;
  ccEmails: string[];
  isGp: boolean;
  kycStatus: 'not_started' | 'in_progress' | 'approved' | 'expired';
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Read a filled-in investor register: the rows it can read, and every row it cannot. */
export function readInvestorsTemplate(
  grid: Grid | null,
  types: string[],
  kyc: Record<InvestorImportRow['kycStatus'], string>,
): { rows: InvestorImportRow[]; errors: string[] } {
  const rows: InvestorImportRow[] = [];
  const errors: string[] = [];
  if (!grid) return { rows, errors: [`This file has no ${INVESTORS_SHEET} sheet. Start from the template on the Investors page.`] };
  const headerAt = grid.findIndex((r) => text(r[0]) === 'LP_ID');
  if (headerAt < 0) return { rows, errors: [`The ${INVESTORS_SHEET} sheet has no LP_ID header row.`] };
  const seen = new Set<string>();
  const norm = (s: string) => s.trim().toLowerCase();
  grid.slice(headerAt + 1).forEach((r, i) => {
    const at = `Row ${headerAt + i + 2}`;
    const lpId = text(r[0]);
    if (!lpId && !text(r[1])) return;
    const problems: string[] = [];
    if (!lpId) problems.push('no LP_ID');
    else if (seen.has(lpId)) problems.push(`${lpId} is listed twice`);
    const name = text(r[1]);
    if (!name) problems.push('no legal name');
    const typeText = text(r[2]);
    const type = typeText ? types.find((t) => norm(t) === norm(typeText)) : '';
    if (type === undefined) problems.push(`type: one of ${types.join(', ')}`);
    const email = text(r[4]);
    if (email && !EMAIL_RE.test(email)) problems.push(`notices email "${email}" is not an address`);
    const ccEmails = text(r[5]).split(/[,;\s]+/).filter(Boolean);
    const badCc = ccEmails.filter((e) => !EMAIL_RE.test(e));
    if (badCc.length) problems.push(`copies to: not an address — ${badCc.join(', ')}`);
    const gpText = norm(text(r[6]));
    if (gpText && !['yes', 'y', 'no', 'n'].includes(gpText)) problems.push('general partner: Yes or No');
    const kycText = text(r[7]);
    const kycStatus = kycText
      ? (Object.entries(kyc).find(([code, label]) => norm(label) === norm(kycText) || norm(code) === norm(kycText))?.[0] as InvestorImportRow['kycStatus'] | undefined)
      : 'not_started';
    if (!kycStatus) problems.push(`KYC: one of ${Object.values(kyc).join(', ')}`);
    if (problems.length) {
      errors.push(`${at}${lpId ? ` (${lpId})` : ''}: ${problems.join('; ')}.`);
      return;
    }
    seen.add(lpId);
    rows.push({ lpId, name, type: type || '', country: text(r[3]) || null, email: email || null, ccEmails, isGp: gpText === 'yes' || gpText === 'y', kycStatus: kycStatus! });
  });
  return { rows, errors };
}
