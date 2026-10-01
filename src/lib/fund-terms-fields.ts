/**
 * Every fund term as a person fills it in: its label, what it means, what it
 * accepts, and which section it sits in.
 *
 * One list for the Fund terms screen and the downloadable terms template, so
 * the two cannot drift apart. Parsing lives here too, and accepts what a person
 * writes in a spreadsheet — "2%", "Quarterly", "The general partner" — as well
 * as the stored codes.
 */

import {
  feeForRange,
  fmt,
  fmtDate,
  pct,
  periodContaining,
  periodMonths,
  BLANK_TERMS,
  type FundTerms,
} from '@/engine';
import { CURRENCIES } from './currencies';

export type Kind = 'text' | 'currency' | 'int' | 'rate' | 'money' | 'date' | 'select' | 'yesno' | 'investor' | 'investors';

export type TermKey = Exclude<keyof FundTerms, 'effectiveFrom' | 'createdAt' | 'note'>;

export interface Field {
  key: TermKey;
  label: string;
  kind: Kind;
  /** What the field means, behind the (i). Plain words; no jargon it does not explain. */
  info: string;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}

export interface Group {
  id: 'basics' | 'fee' | 'closings' | 'notice' | 'payment';
  title: string;
  subtitle: string;
  fields: Field[];
}

export const PERIOD_OPTIONS = [
  { value: '0.25', label: 'Quarterly' },
  { value: '0.5', label: 'Half-yearly' },
  { value: '1', label: 'Yearly' },
];

export const DAY_COUNT_OPTIONS = [
  { value: 'period_fraction', label: 'Equal periods, part periods by days' },
  { value: 'actual_365', label: 'Exact days ÷ 365' },
  { value: 'actual_360', label: 'Exact days ÷ 360' },
  { value: '30_360', label: '30-day months ÷ 360' },
];

export const GROUPS: Group[] = [
  {
    id: 'basics',
    title: 'Fund basics',
    subtitle: 'how figures are stated, and the fund’s life',
    fields: [
      {
        key: 'reportingCurrency',
        label: 'Reporting currency',
        kind: 'currency',
        placeholder: 'Search, e.g. USD or dollar',
        info: 'The currency every amount on this fund’s notices and reports is stated in.',
      },
      {
        key: 'roundingDecimals',
        label: 'Rounding decimals',
        kind: 'int',
        placeholder: 'e.g. 2',
        info: 'How many decimal places each investor’s share is rounded to. 2 means cents. 0 suits a currency without cents, such as JPY.',
      },
      {
        key: 'roundingPlugLpId',
        label: 'Rounding plug',
        kind: 'investor',
        placeholder: 'Pick an investor',
        hint: 'Can also be picked on each call.',
        info: 'Rounding every investor’s share can leave a cent or two over. This investor takes that remainder, so each call adds up exactly. Usually the largest investor.',
      },
      {
        key: 'orgExpenseCap',
        label: 'Organizational expense cap',
        kind: 'money',
        placeholder: 'e.g. 1500000',
        info: 'The most the fund may charge investors for the cost of setting it up. Anything above it is the general partner’s to bear, under the LPA.',
      },
      {
        key: 'fundTermEnd',
        label: 'Fund term ends',
        kind: 'date',
        hint: 'Before any extension.',
        info: 'When the fund is due to wind up, before any extension the LPA allows.',
      },
    ],
  },
  {
    id: 'fee',
    title: 'Management fee',
    subtitle: 'what is charged, how, and what changes after the investment period',
    fields: [
      {
        key: 'feeRateAnnual',
        label: 'Annual rate',
        kind: 'rate',
        placeholder: 'e.g. 2%',
        hint: 'Blank means no management fee.',
        info: 'The yearly management fee, as a percentage of the fee basis. Type 2% or 0.02.',
      },
      {
        key: 'feeBasis',
        label: 'Charged on',
        kind: 'select',
        info: 'What the fee is a percentage of. Commitment: what each investor promised. Invested capital: the cost of the investments the fund still holds.',
        options: [
          { value: 'Commitment', label: 'Commitment' },
          { value: 'Invested_Capital', label: 'Invested capital' },
          { value: 'NAV', label: 'NAV' },
        ],
      },
      {
        key: 'feePeriodFraction',
        label: 'How often',
        kind: 'select',
        info: 'How often the fee is charged. Each quarterly fee is a quarter of the year’s fee.',
        options: PERIOD_OPTIONS,
      },
      {
        key: 'feeTiming',
        label: 'Billed',
        kind: 'select',
        info: 'Whether each fee is charged at the start of the period it covers (in advance) or at the end (in arrears).',
        options: [
          { value: 'advance', label: 'In advance' },
          { value: 'arrears', label: 'In arrears' },
        ],
      },
      {
        key: 'feeDayCount',
        label: 'Days counted as',
        kind: 'select',
        info: 'How the fee for a period is worked out. Most LPAs charge equal periods — each quarter is a quarter of the year’s fee — and charge a part period, such as for an investor who joins mid-quarter, by the days they were in. Some LPAs count exact days instead. The example under the field shows what each gives.',
        options: DAY_COUNT_OPTIONS,
      },
      {
        key: 'feeReducesUnfunded',
        label: 'Counts against commitment',
        kind: 'yesno',
        info: 'Yes if the fee counts against what investors promised, so it lowers what they still owe. No if it is charged on top.',
      },
      {
        key: 'feeExemptLpIds',
        label: 'Exempt investors',
        kind: 'investors',
        placeholder: 'Pick investors',
        hint: 'Or mark an investor exempt at the closing that admits them.',
        info: 'Investors who pay no management fee at all, usually the general partner and its affiliates.',
      },
      {
        key: 'investmentPeriodEnd',
        label: 'Investment period ends',
        kind: 'date',
        info: 'The last day the fund may make new investments. Many LPAs change the management fee after this date.',
      },
    ],
  },
  {
    id: 'closings',
    title: 'Later closings',
    subtitle: 'what investors who join at a later close pay',
    fields: [
      {
        key: 'lateCloseInterestRate',
        label: 'Interest on catching up',
        kind: 'rate',
        placeholder: 'e.g. 8%, or blank for none',
        hint: 'A year. Blank means no interest.',
        info: 'An investor who joins at a later closing pays their share of earlier calls. Many LPAs add interest on that, at this rate a year, from each call’s due date.',
      },
      {
        key: 'lateCloseInterestBasis',
        label: 'Interest is',
        kind: 'select',
        info: 'Whether that interest is simple, or compounded.',
        options: [
          { value: 'simple', label: 'Simple' },
          { value: 'compound', label: 'Compound' },
        ],
      },
      {
        key: 'equalizationInterestTo',
        label: 'Interest goes to',
        kind: 'select',
        info: 'Who receives the interest late investors pay: the investors who paid first, the fund, or the general partner.',
        options: [
          { value: 'existing_lps', label: 'The existing investors' },
          { value: 'fund', label: 'The fund' },
          { value: 'gp', label: 'The general partner' },
        ],
      },
      {
        key: 'equalizationInterestUntil',
        label: 'Interest runs until',
        kind: 'select',
        info: 'Interest on the late investor’s share of earlier calls starts on each call’s due date. It stops either when they actually pay — the due date of the call or statement that collects it — or on the closing date.',
        options: [
          { value: 'collection_due_date', label: 'They pay (the collecting call or statement is due)' },
          { value: 'closing_date', label: 'The closing date' },
        ],
      },
      {
        key: 'catchUpFeeInterest',
        label: 'Interest on the catch-up fee',
        kind: 'select',
        info: 'A late investor pays the management fee they missed. Interest on it, at the same rate, runs to their closing: on the whole fee from the first closing, or on each fee period’s part from that period’s start. Or none.',
        options: [
          { value: 'first_close', label: 'From the first closing' },
          { value: 'per_period', label: 'From each fee period’s start' },
          { value: 'none', label: 'None' },
        ],
      },
      {
        key: 'catchUpFeeInterestRate',
        label: 'Interest rate on the catch-up fee',
        kind: 'rate',
        placeholder: 'e.g. 5%, or blank for the rate above',
        hint: 'A year. Blank uses the interest rate on catching up.',
        info: 'Some LPAs charge a different rate on the catch-up management fee than on the share of earlier calls. Blank uses the same rate; set "Interest on the catch-up fee" to None for no interest on it.',
      },
      {
        key: 'catchUpFeeUntil',
        label: 'Catch-up fee covers',
        kind: 'select',
        info: 'A late investor pays the management fee as if they had joined at the first closing. The catch-up covers the fee periods already billed to the investors in before them, and every later period bills them in full like everyone else — or it covers every day up to their closing, and later periods bill them from that day.',
        options: [
          { value: 'billed_periods', label: 'The fee periods already billed' },
          { value: 'closing_date', label: 'Every day up to the closing' },
        ],
      },
      {
        key: 'catchUpFeeTo',
        label: 'Catch-up fee goes to',
        kind: 'select',
        info: 'A late investor also pays the management fee they missed before joining — the catch-up fee. This is who receives it.',
        options: [
          { value: 'gp', label: 'The general partner' },
          { value: 'existing_lps', label: 'The existing investors' },
        ],
      },
    ],
  },
  {
    id: 'notice',
    title: 'Who the notice is from',
    subtitle: 'printed on every notice',
    fields: [
      {
        key: 'gpName',
        label: 'General partner',
        kind: 'text',
        placeholder: 'e.g. Meridian GP LLC',
        info: 'The general partner’s legal name. The notice letter is written on its behalf.',
      },
      {
        key: 'signatoryName',
        label: 'Signatory',
        kind: 'text',
        placeholder: 'e.g. Jane Doe',
        info: 'The person who signs every notice.',
      },
      {
        key: 'signatoryTitle',
        label: 'Signatory title',
        kind: 'text',
        placeholder: 'e.g. Managing Partner',
        info: 'The signatory’s title, printed under their name.',
      },
    ],
  },
  {
    id: 'payment',
    title: 'Payment instructions',
    subtitle: 'printed on every notice and statement',
    fields: [
      {
        key: 'paymentBankName',
        label: 'Bank',
        kind: 'text',
        placeholder: 'e.g. JPMorgan Chase Bank, N.A.',
        info: 'The bank investors wire money to. Nothing prints on a notice until the bank and account number are both set.',
      },
      {
        key: 'paymentAccountName',
        label: 'Account name',
        kind: 'text',
        placeholder: 'e.g. Meridian Growth Partners III, L.P.',
        info: 'The name on the fund’s account, exactly as the bank holds it. A mismatch is the commonest reason a wire is held.',
      },
      {
        key: 'paymentAccountNo',
        label: 'Account number',
        kind: 'text',
        placeholder: 'e.g. 000123456789',
        info: 'The fund’s account number, or IBAN.',
      },
      {
        key: 'paymentSwift',
        label: 'SWIFT / BIC',
        kind: 'text',
        placeholder: 'e.g. CHASUS33',
        info: 'The bank’s international code, for investors wiring from abroad.',
      },
      {
        key: 'paymentRouting',
        label: 'Routing',
        kind: 'text',
        placeholder: 'e.g. ABA 021000021',
        info: 'The domestic routing code the bank’s country uses: an ABA number in the US, a sort code in the UK, an IFSC in India.',
      },
      {
        key: 'paymentReference',
        label: 'Reference',
        kind: 'text',
        placeholder: 'e.g. {LP_ID}/MGP3/{CALL_NO}',
        hint: '{LP_ID} and {CALL_NO} are filled in per notice. On an equalization statement, {CALL_NO} is EQ and the closing number.',
        info: 'What each investor quotes on the wire, so the payment can be matched to them. {LP_ID} and {CALL_NO} are replaced on each notice; on an equalization statement {CALL_NO} becomes EQ2 for closing 2.',
      },
    ],
  },
];

export const FIELDS = GROUPS.flatMap((g) => g.fields);
export const FIELD = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<TermKey, Field>;

/** The fee basis inside a sentence: "invested capital", "commitment" — but "NAV" stays NAV. */
export function basisInWords(basis: string | null): string {
  const label = display(FIELD.feeBasis, basis ?? 'Commitment');
  return label === label.toUpperCase() ? label : label.toLowerCase();
}

/** A term as it reads on the page. */
export function display(field: Field, value: FundTerms[TermKey], names: (lpId: string) => string = (id) => id): string {
  if (value === null || value === undefined) return '';
  switch (field.kind) {
    case 'rate':
      return pct(value as number);
    case 'money':
      return fmt(value as number);
    case 'date':
      return fmtDate(value as string);
    case 'yesno':
      return value ? 'Yes' : 'No';
    case 'investor':
      return names(value as string);
    case 'investors':
      return (value as string[]).map(names).join(', ');
    case 'currency': {
      const c = CURRENCIES.find((o) => o.value === value);
      return c && c.label !== c.value ? `${c.value} — ${c.label}` : String(value);
    }
    case 'select':
      return optionLabel(field, String(value));
    default:
      return String(value);
  }
}

/** An option's label; a stored value that is not one of the options says so rather than borrowing one. */
export function optionLabel(field: Field, value: string): string {
  return field.options?.find((o) => Number(o.value) === Number(value) || o.value === value)?.label ?? `Other (${value})`;
}

/** A term as it sits in a form: always a string, blank when unset. */
export function toDraft(field: Field, value: FundTerms[TermKey]): string {
  if (value === null || value === undefined) return '';
  if (field.kind === 'yesno') return value ? 'Y' : 'N';
  if (field.kind === 'investors') return (value as string[]).join(',');
  // Rates are written as people write them: 2%, not 0.02.
  if (field.kind === 'rate') return `${Number(((value as number) * 100).toFixed(8))}%`;
  if (field.key === 'feePeriodFraction') {
    return PERIOD_OPTIONS.find((o) => Number(o.value) === value)?.value ?? String(value);
  }
  return String(value);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/**
 * What a person typed, back to a term — or the reason it cannot be one.
 * Accepts an option's label as well as its code, and "2%" for a rate.
 */
export function fromDraft(field: Field, raw: unknown): { value: unknown } | { error: string } {
  const text = String(raw ?? '').trim();
  if (field.kind === 'investors') return { value: text.split(/[,;]/).map((x) => x.trim()).filter(Boolean) };
  if (text === '') return { value: null };
  switch (field.kind) {
    case 'currency': {
      const code = text.toUpperCase();
      return CURRENCIES.some((c) => c.value === code) ? { value: code } : { error: 'Pick a currency from the list, e.g. USD.' };
    }
    case 'int': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 0 && n <= 4 ? { value: n } : { error: 'A whole number from 0 to 4.' };
    }
    case 'rate': {
      const percent = text.endsWith('%');
      const n = Number(text.replace(/%$/, '').trim());
      if (!Number.isFinite(n)) return { error: 'A rate, like 2% or 0.02.' };
      const value = percent ? n / 100 : n;
      // A bare 2 is the likeliest slip: say so rather than store a 200% fee.
      return value >= 0 && value < 1 ? { value: Number(value.toFixed(10)) } : { error: 'Write 2% (or 0.02) for two percent.' };
    }
    case 'money': {
      const n = Number(text.replace(/[,\s]/g, ''));
      return Number.isFinite(n) && n >= 0 ? { value: n } : { error: 'An amount, like 1500000.' };
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: text } : { error: 'A date, like 2026-01-15.' };
    case 'yesno': {
      const t = norm(text);
      if (['y', 'yes', 'true'].includes(t)) return { value: true };
      if (['n', 'no', 'false'].includes(t)) return { value: false };
      return { error: 'Yes or No.' };
    }
    case 'select': {
      const hit = field.options?.find((o) => norm(o.value) === norm(text) || norm(o.label) === norm(text));
      if (!hit) return { error: `One of: ${field.options?.map((o) => o.label).join(', ')}.` };
      return { value: field.key === 'feePeriodFraction' ? Number(hit.value) : hit.value };
    }
    default:
      return { value: text };
  }
}

/**
 * What each way of counting days gives, on figures anyone can check: 10m of
 * commitment at the fund's rate, for a full period and for an investor who
 * joins part-way through it.
 */
export function dayCountExample(
  dayCount: string,
  rate: number | null,
  periodFraction: number | null,
): { full: string; part: string } {
  const r = rate && rate > 0 ? rate : 0.02;
  const months = periodMonths(periodFraction);
  const period = periodContaining('2026-08-15', months);
  const terms: FundTerms = {
    ...BLANK_TERMS,
    effectiveFrom: '2000-01-01',
    createdAt: '',
    feeBasis: 'Commitment',
    feeRateAnnual: r,
    feePeriodFraction: periodFraction ?? 0.25,
    feeDayCount: dayCount as FundTerms['feeDayCount'],
  };
  const run = (from: string) =>
    feeForRange(period.from, period.to, [terms], [{ lpId: 'X', name: 'X', commitments: [{ from, amount: 10_000_000 }] }]).lines[0];
  const full = run('2000-01-01');
  const part = run('2026-08-15');
  const sum = (l: typeof full) =>
    `10,000,000 × ${pct(r)} × ${l.slices.filter((s) => s.amount).map((s) => s.fractionWorking).join(' + ')} = ${fmt(l.fee)}`;
  return {
    full: `Full ${months === 12 ? 'year' : months === 6 ? 'half-year' : 'quarter'}, ${fmtDate(period.from)} – ${fmtDate(period.to)}: ${sum(full)}`,
    part: `Joining 15 August 2026: ${sum(part)}`,
  };
}
