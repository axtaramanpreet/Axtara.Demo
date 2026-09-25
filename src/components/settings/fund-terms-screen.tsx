'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { FundInvestor } from '@/adapters/storage/types';
import {
  BLANK_TERMS,
  afterInvestmentPeriod,
  changedTerms,
  dayAfter,
  dayBefore,
  draftTerms,
  fmt,
  fmtDate,
  fmtStamp,
  pct,
  scheduledAfter,
  termsOn,
  unsetTerms,
  type FundTerms,
} from '@/engine';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox, MultiCombobox, type ComboOption } from '@/components/ui/combobox';
import { InfoTip } from '@/components/ui/info-tip';
import { CURRENCIES } from '@/lib/currencies';
import { Tag } from '@/components/ui/tag';

/**
 * A fund's terms: what is in force, a form to record a change, and the history.
 *
 * Terms are never edited. "Record a change" adds a row from the date it
 * applies, pre-filled with what is in force, so the accountant changes only
 * what changed. A mistake is corrected the same way — same date, later entry.
 */

type Kind = 'text' | 'currency' | 'int' | 'rate' | 'money' | 'date' | 'select' | 'yesno' | 'investor' | 'investors';

interface Field {
  key: Exclude<keyof FundTerms, 'effectiveFrom' | 'createdAt' | 'note'>;
  label: string;
  kind: Kind;
  /** What the field means, behind the (i). Plain words; no jargon it does not explain. */
  info: string;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}

const GROUPS: { title: string; subtitle: string; fields: Field[] }[] = [
  {
    title: 'Reporting and rounding',
    subtitle: 'how figures are stated',
    fields: [
      {
        key: 'reportingCurrency',
        label: 'Reporting currency',
        kind: 'currency',
        placeholder: 'Search, e.g. USD or dollar',
        info: 'The currency every amount on this fund\u2019s notices and reports is stated in.',
      },
      {
        key: 'roundingDecimals',
        label: 'Rounding decimals',
        kind: 'int',
        placeholder: 'e.g. 2',
        info: 'How many decimal places each investor\u2019s share is rounded to. 2 means cents. 0 suits a currency without cents, such as JPY.',
      },
      {
        key: 'roundingPlugLpId',
        label: 'Rounding plug',
        kind: 'investor',
        placeholder: 'Pick an investor',
        info: 'Rounding every investor\u2019s share can leave a cent or two over. This investor takes that remainder, so each call adds up exactly. Usually the largest investor.',
      },
    ],
  },
  {
    title: 'Management fee',
    subtitle: 'during the investment period',
    fields: [
      {
        key: 'feeBasis',
        label: 'Fee basis',
        kind: 'select',
        info: 'What the fee is a percentage of. Commitment: what each investor promised. Invested capital: the cost of the investments the fund still holds.',
        options: [
          { value: 'Commitment', label: 'Commitment' },
          { value: 'Invested_Capital', label: 'Invested capital' },
          { value: 'NAV', label: 'NAV' },
        ],
      },
      {
        key: 'feeRateAnnual',
        label: 'Annual rate',
        kind: 'rate',
        placeholder: 'e.g. 0.02',
        hint: 'A fraction: 0.02 is 2% a year.',
        info: 'The yearly management fee, as a fraction of the fee basis. 0.02 means 2% a year.',
      },
      {
        key: 'feePeriodFraction',
        label: 'Period charged per call',
        kind: 'rate',
        placeholder: 'e.g. 0.25',
        hint: '0.25 is a quarter.',
        info: 'How much of a year\u2019s fee each call charges. 0.25 is a quarter; 0.5 is half a year.',
      },
      {
        key: 'feeReducesUnfunded',
        label: 'Drawn from commitment',
        kind: 'yesno',
        info: 'Yes if the fee counts against what investors promised, so it lowers what they still owe. No if it is charged on top.',
      },
      {
        key: 'feeExemptLpIds',
        label: 'Exempt investors',
        kind: 'investors',
        placeholder: 'Pick investors',
        info: 'Investors who pay no management fee at all, usually the general partner and its affiliates.',
      },
      {
        key: 'orgExpenseCap',
        label: 'Organizational expense cap',
        kind: 'money',
        placeholder: 'e.g. 1500000',
        info: 'The most the fund may charge investors for the cost of setting it up. Anything above it is the general partner\u2019s to bear, under the LPA.',
      },
    ],
  },
  {
    title: 'Who the notice is from',
    subtitle: 'printed on every notice',
    fields: [
      {
        key: 'gpName',
        label: 'General partner',
        kind: 'text',
        placeholder: 'e.g. Meridian GP LLC',
        info: 'The general partner\u2019s legal name. The notice letter is written on its behalf.',
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
        info: 'The signatory\u2019s title, printed under their name.',
      },
    ],
  },
  {
    title: 'The fund\u2019s life',
    subtitle: 'dates the fee and closings depend on',
    fields: [
      {
        key: 'investmentPeriodEnd',
        label: 'Investment period ends',
        kind: 'date',
        info: 'The last day the fund may make new investments. Many LPAs change the management fee after this date.',
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
    title: 'LPA terms',
    subtitle: 'from this fund\u2019s partnership agreement',
    fields: [
      {
        key: 'feeTiming',
        label: 'Fee billed',
        kind: 'select',
        info: 'Whether each fee is charged at the start of the period it covers (in advance) or at the end (in arrears).',
        options: [
          { value: 'advance', label: 'In advance' },
          { value: 'arrears', label: 'In arrears' },
        ],
      },
      {
        key: 'feeDayCount',
        label: 'Fee day count',
        kind: 'select',
        info: 'How a part of a period is measured when a fee has to be pro-rated, for example for an investor who joins mid-quarter. Period fraction uses the fraction above.',
        options: [
          { value: 'period_fraction', label: 'Period fraction (e.g. 0.25)' },
          { value: 'actual_365', label: 'Actual / 365' },
          { value: 'actual_360', label: 'Actual / 360' },
          { value: '30_360', label: '30 / 360' },
        ],
      },
      {
        key: 'lateCloseInterestRate',
        label: 'Late-closer interest',
        kind: 'rate',
        placeholder: 'e.g. 0.08, or blank for none',
        hint: 'A fraction a year. Blank means none.',
        info: 'Investors who join at a later closing pay their share of earlier calls. Many LPAs add interest on that catch-up, at this rate a year.',
      },
      {
        key: 'lateCloseInterestBasis',
        label: 'Late-closer interest basis',
        kind: 'select',
        info: 'Whether that interest is simple, or compounded.',
        options: [
          { value: 'simple', label: 'Simple' },
          { value: 'compound', label: 'Compound' },
        ],
      },
      {
        key: 'catchUpFeeTo',
        label: 'Catch-up fee goes to',
        kind: 'select',
        info: 'When a late investor pays the management fees they missed, who receives them.',
        options: [
          { value: 'gp', label: 'The general partner' },
          { value: 'existing_lps', label: 'The existing investors' },
        ],
      },
      {
        key: 'equalizationInterestTo',
        label: 'Equalization interest goes to',
        kind: 'select',
        info: 'Who receives the interest late investors pay: the investors who paid first, the fund, or the general partner.',
        options: [
          { value: 'existing_lps', label: 'The existing investors' },
          { value: 'fund', label: 'The fund' },
          { value: 'gp', label: 'The general partner' },
        ],
      },
    ],
  },
];

const FIELDS = GROUPS.flatMap((g) => g.fields);
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<string, string>;

/** A term as it reads on the page. */
function display(field: Field, value: FundTerms[Field['key']], investors: FundInvestor[]): string {
  if (value === null || value === undefined) return '';
  const named = (id: string) => {
    const name = investors.find((i) => i.lpId === id)?.name;
    return name ? `${id} — ${name}` : id;
  };
  switch (field.kind) {
    case 'rate':
      return `${pct(value as number)} (${value})`;
    case 'money':
      return fmt(value as number);
    case 'date':
      return fmtDate(value as string);
    case 'yesno':
      return value ? 'Yes' : 'No';
    case 'investor':
      return named(value as string);
    case 'investors':
      return (value as string[]).map(named).join(', ');
    case 'currency': {
      const c = CURRENCIES.find((o) => o.value === value);
      return c && c.label !== c.value ? `${c.value} — ${c.label}` : String(value);
    }
    case 'select':
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** A term as it sits in the form: always a string, blank when unset. */
function toDraft(field: Field, value: FundTerms[Field['key']]): string {
  if (value === null || value === undefined) return '';
  if (field.kind === 'yesno') return value ? 'Y' : 'N';
  if (field.kind === 'investors') return (value as string[]).join(',');
  return String(value);
}

/** The form's string back to a term, or the reason it cannot be one. */
function fromDraft(field: Field, raw: string): { value: unknown } | { error: string } {
  const text = raw.trim();
  if (field.kind === 'investors') return { value: text.split(',').map((x) => x.trim()).filter(Boolean) };
  if (text === '') return { value: null };
  switch (field.kind) {
    case 'currency':
      return CURRENCIES.some((c) => c.value === text) ? { value: text } : { error: 'Pick a currency from the list.' };
    case 'int': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 0 && n <= 4 ? { value: n } : { error: 'A whole number from 0 to 4.' };
    }
    case 'rate': {
      const n = Number(text);
      // A rate typed as a percentage is the likeliest slip; say so rather than
      // storing a 200% fee.
      if (!Number.isFinite(n)) return { error: 'A number, like 0.02.' };
      return n >= 0 && n < 1 ? { value: n } : { error: 'A fraction below 1: 2% is 0.02.' };
    }
    case 'money': {
      const n = Number(text.replace(/[,\s]/g, ''));
      return Number.isFinite(n) && n >= 0 ? { value: n } : { error: 'An amount, like 1500000.' };
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { value: text } : { error: 'A date.' };
    case 'yesno':
      return { value: text === 'Y' };
    default:
      return { value: text };
  }
}

const RATE = GROUPS[1].fields.find((f) => f.key === 'feeRateAnnual')!;
const BASIS = GROUPS[1].fields.find((f) => f.key === 'feeBasis')!;

export function FundTermsScreen({
  fundId,
  history,
  investors,
  today,
  canWrite,
}: {
  fundId: string;
  history: FundTerms[];
  /** For the rounding plug and the exempt list, which name investors by LP_ID. */
  investors: FundInvestor[];
  /** YYYY-MM-DD, from the server, so the page reads the same on both sides. */
  today: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const inForce = termsOn(history, today);
  const unset = new Set(unsetTerms(inForce ?? BLANK_TERMS));
  const scheduled = scheduledAfter(history, today);
  const investorOptions: ComboOption[] = investors.map((i) => ({ value: i.lpId, label: i.name }));

  const [open, setOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The fee once the investment period is over, recorded as its own dated row.
  const [afterIp, setAfterIp] = useState(false);
  const [afterBasis, setAfterBasis] = useState('Invested_Capital');
  const [afterRate, setAfterRate] = useState('');

  function start() {
    const { terms, suggested: s } = draftTerms(inForce);
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, toDraft(f, terms[f.key])])));
    setSuggested(new Set(s));
    setEffectiveFrom(today);
    setNote('');
    setErrors({});
    setFailure(null);
    setAfterIp(false);
    setAfterBasis('Invested_Capital');
    setAfterRate('');
    setOpen(true);
  }

  const set = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // Once someone touches a suggested value it is their answer, not ours.
    setSuggested((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  };

  const ipEnd = (draft.investmentPeriodEnd ?? '').trim();

  async function save() {
    const parsed: Record<string, unknown> = {};
    const found: Record<string, string> = {};
    for (const f of FIELDS) {
      const r = fromDraft(f, draft[f.key] ?? '');
      if ('error' in r) found[f.key] = r.error;
      else parsed[f.key] = r.value;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) found.effectiveFrom = 'The date these terms apply from.';

    let afterRateValue: number | null = null;
    if (afterIp) {
      if (!ipEnd) found.afterIp = 'Set when the investment period ends first.';
      else if (effectiveFrom > ipEnd) {
        found.afterIp = 'This change already starts after the investment period. Set the fee above instead.';
      }
      const r = fromDraft(RATE, afterRate);
      if ('error' in r) found.afterRate = r.error;
      else afterRateValue = r.value as number | null;
    }

    setErrors(found);
    if (Object.keys(found).length) return;

    const now: Omit<FundTerms, 'createdAt'> = {
      ...BLANK_TERMS,
      ...(parsed as Partial<FundTerms>),
      effectiveFrom,
      note: note.trim() || null,
    };
    const rows = afterIp
      ? [now, afterInvestmentPeriod(now, { feeBasis: afterBasis || null, feeRateAnnual: afterRateValue })]
      : [now];

    setSaving(true);
    setFailure(null);
    try {
      const repo = createSupabaseRepository(createBrowserSupabase());
      await repo.addFundTerms(fundId, rows);
      setOpen(false);
      startRefresh(() => router.refresh());
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not record the terms.');
    } finally {
      setSaving(false);
    }
  }

  function input(f: Field) {
    const value = draft[f.key] ?? '';
    switch (f.kind) {
      case 'currency':
        return (
          <Combobox
            label={f.label}
            options={CURRENCIES}
            value={value || null}
            onChange={(v) => set(f.key, v ?? '')}
            placeholder={f.placeholder}
          />
        );
      case 'investor':
        return (
          <Combobox
            label={f.label}
            options={investorOptions}
            value={value || null}
            onChange={(v) => set(f.key, v ?? '')}
            placeholder={investors.length ? f.placeholder : 'No investors yet'}
            empty="No investor matches"
          />
        );
      case 'investors':
        return (
          <MultiCombobox
            label={f.label}
            options={investorOptions}
            value={value ? value.split(',').filter(Boolean) : []}
            onChange={(v) => set(f.key, v.join(','))}
            placeholder={investors.length ? f.placeholder : 'No investors yet'}
            empty="No investor matches"
          />
        );
      case 'select':
      case 'yesno':
        return (
          <select className="cell" aria-label={f.label} value={value} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">Not set</option>
            {(f.kind === 'yesno'
              ? [
                  { value: 'Y', label: 'Yes' },
                  { value: 'N', label: 'No' },
                ]
              : f.options ?? []
            ).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      default:
        return (
          <input
            className="cell"
            type={f.kind === 'date' ? 'date' : 'text'}
            aria-label={f.label}
            placeholder={f.placeholder}
            style={{ textAlign: ['rate', 'money', 'int'].includes(f.kind) ? 'right' : 'left' }}
            value={value}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
    }
  }

  function note_(f: Field) {
    if (errors[f.key]) {
      return (
        <span role="alert" style={{ color: 'var(--destructive)' }}>
          {errors[f.key]}
        </span>
      );
    }
    if (suggested.has(f.key)) {
      return (
        <>
          <Tag tone="warn">Suggested</Tag> <span className="text-muted">check against the LPA</span>
        </>
      );
    }
    return <span className="text-muted">{f.hint}</span>;
  }

  // Newest first, and which row each was superseded by, for the history list.
  const ordered = [...history].sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom
      ? b.createdAt.localeCompare(a.createdAt)
      : b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const chronological = [...ordered].reverse();

  return (
    <div style={{ maxWidth: 1000, opacity: refreshing ? 0.6 : 1, transition: 'opacity 120ms' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1>Fund terms</h1>
          <p className="text-muted" style={{ maxWidth: 620, textWrap: 'pretty' }}>
            {inForce
              ? `In force since ${fmtDate(inForce.effectiveFrom)}. A new capital call starts with these. Changing a term records it from a date; nothing earlier is rewritten.`
              : 'Nothing recorded yet. A new capital call starts blank until the fund’s terms are recorded here.'}
          </p>
        </div>
        {canWrite && !open && (
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="primary" onClick={start}>
              {inForce ? 'Record a change' : 'Record the fund’s terms'}
            </Button>
          </div>
        )}
      </div>

      {!canWrite && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You can see these terms but not change them.
        </p>
      )}

      {open ? (
        <Card title={inForce ? 'Record a change' : 'Record the fund’s terms'} style={{ marginTop: 20 }} bodyPadding="16px">
          <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
            Pre-filled with what is in force. Where nothing is recorded, a common choice is suggested
            — check each against the LPA. Change only what changed, and say from when.
          </p>
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <td style={{ width: 260, fontWeight: 600 }}>
                  Applies from
                  <InfoTip label="Applies from">
                    The first day these terms apply. Using the same date as an earlier entry corrects it;
                    a later date records a change from then, and nothing earlier is rewritten.
                  </InfoTip>
                </td>
                <td style={{ width: 300, padding: '2px 6px' }}>
                  <input
                    className="cell"
                    type="date"
                    aria-label="Applies from"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                </td>
                <td style={{ fontSize: 12 }}>
                  {errors.effectiveFrom ? (
                    <span role="alert" style={{ color: 'var(--destructive)' }}>
                      {errors.effectiveFrom}
                    </span>
                  ) : null}
                </td>
              </tr>
              {GROUPS.map((group) => [
                <tr key={group.title}>
                  <td colSpan={3} style={{ fontWeight: 600, paddingTop: 18 }}>
                    {group.title}
                  </td>
                </tr>,
                ...group.fields.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.label}
                      <InfoTip label={f.label}>{f.info}</InfoTip>
                    </td>
                    <td style={{ padding: '2px 6px' }}>{input(f)}</td>
                    <td style={{ fontSize: 12 }}>{note_(f)}</td>
                  </tr>
                )),
              ])}
              <tr>
                <td colSpan={3} style={{ fontWeight: 600, paddingTop: 18 }}>
                  Management fee after the investment period
                </td>
              </tr>
              <tr>
                <td>
                  Fee changes after it
                  <InfoTip label="Fee changes after the investment period">
                    Many LPAs move the fee from commitments to invested capital, lower the rate, or both, once
                    the investment period ends. Ticking this records that as its own change, from the day after
                    the period ends{ipEnd ? ` (${fmtDate(dayAfter(ipEnd))})` : ''}.
                  </InfoTip>
                </td>
                <td style={{ padding: '2px 6px' }}>
                  <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <input type="checkbox" checked={afterIp} onChange={(e) => setAfterIp(e.target.checked)} />
                    {ipEnd ? `From ${fmtDate(dayAfter(ipEnd))}` : 'Set the investment period end above'}
                  </label>
                </td>
                <td style={{ fontSize: 12 }}>
                  {errors.afterIp ? (
                    <span role="alert" style={{ color: 'var(--destructive)' }}>
                      {errors.afterIp}
                    </span>
                  ) : (
                    scheduled.length > 0 && (
                      <span className="text-muted">Already scheduled below. Ticking this adds a newer one.</span>
                    )
                  )}
                </td>
              </tr>
              {afterIp && (
                <>
                  <tr>
                    <td>
                      Fee basis after
                      <InfoTip label="Fee basis after the investment period">{BASIS.info}</InfoTip>
                    </td>
                    <td style={{ padding: '2px 6px' }}>
                      <select
                        className="cell"
                        aria-label="Fee basis after the investment period"
                        value={afterBasis}
                        onChange={(e) => setAfterBasis(e.target.value)}
                      >
                        {BASIS.options!.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td>
                      Annual rate after
                      <InfoTip label="Annual rate after the investment period">{RATE.info}</InfoTip>
                    </td>
                    <td style={{ padding: '2px 6px' }}>
                      <input
                        className="cell"
                        aria-label="Annual rate after the investment period"
                        placeholder="e.g. 0.015"
                        style={{ textAlign: 'right' }}
                        value={afterRate}
                        onChange={(e) => setAfterRate(e.target.value)}
                      />
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {errors.afterRate ? (
                        <span role="alert" style={{ color: 'var(--destructive)' }}>
                          {errors.afterRate}
                        </span>
                      ) : (
                        <span className="text-muted">Blank keeps no rate after the period.</span>
                      )}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td style={{ paddingTop: 18 }}>
                  Note
                  <InfoTip label="Note">Why the terms changed, and where it says so — a clause of the LPA, a side letter, an amendment.</InfoTip>
                </td>
                <td colSpan={2} style={{ padding: '14px 6px 2px' }}>
                  <input
                    className="cell"
                    aria-label="Note"
                    placeholder="e.g. LPA §8.1, fee step-down after the investment period"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          {failure && (
            <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>
              {failure}
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              Record
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {GROUPS.map((group) => (
            <Card key={group.title} title={group.title} subtitle={group.subtitle} style={{ marginTop: 20 }}>
              <dl className="kv" style={{ gridTemplateColumns: '260px 1fr', padding: '14px 16px' }}>
                {group.fields.map((f) => [
                  <dt key={`${f.key}-t`}>
                    {f.label}
                    <InfoTip label={f.label}>{f.info}</InfoTip>
                  </dt>,
                  <dd key={`${f.key}-d`}>
                    {unset.has(f.key) ? (
                      // Blank is shown as blank. What a call does with a blank is
                      // the call's business; this page never pretends to a value
                      // nobody chose.
                      <Tag tone="warn">Not set</Tag>
                    ) : (
                      display(f, (inForce ?? BLANK_TERMS)[f.key], investors) || (
                        <span className="text-muted">None</span>
                      )
                    )}
                  </dd>,
                ])}
              </dl>
            </Card>
          ))}

          {scheduled.length > 0 && (
            <Card title="Scheduled changes" subtitle="recorded, not yet in force" style={{ marginTop: 20 }}>
              <dl className="kv" style={{ gridTemplateColumns: '260px 1fr', padding: '14px 16px' }}>
                {scheduled.map((row) => {
                  const before = termsOn(history, dayBefore(row.effectiveFrom));
                  const changed = changedTerms(before, row);
                  return [
                    <dt key={`${row.effectiveFrom}-${row.createdAt}-t`}>From {fmtDate(row.effectiveFrom)}</dt>,
                    <dd key={`${row.effectiveFrom}-${row.createdAt}-d`}>
                      {changed.length
                        ? changed
                            .map((k) => {
                              const f = FIELDS.find((x) => x.key === k);
                              return f ? `${f.label}: ${display(f, row[f.key], investors) || 'cleared'}` : String(k);
                            })
                            .join(' · ')
                        : 'No change'}
                    </dd>,
                  ];
                })}
              </dl>
            </Card>
          )}
        </>
      )}

      <Card title="History" subtitle="every change, newest first" style={{ marginTop: 20 }}>
        {ordered.length === 0 ? (
          <p className="text-muted" style={{ padding: '14px 16px', margin: 0 }}>
            No terms recorded.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Applies from</th>
                  <th>What changed</th>
                  <th>Entered</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => {
                  const at = chronological.indexOf(row);
                  const before = at > 0 ? chronological[at - 1] : null;
                  const changed = changedTerms(before, row);
                  const superseded = ordered.some(
                    (o) => o !== row && o.effectiveFrom === row.effectiveFrom && o.createdAt > row.createdAt,
                  );
                  return (
                    <tr key={`${row.effectiveFrom}-${row.createdAt}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {fmtDate(row.effectiveFrom)}{' '}
                        {row === inForce && <Tag tone="accent">In force</Tag>}
                        {row.effectiveFrom > today && <Tag>Scheduled</Tag>}
                        {superseded && <Tag>Corrected</Tag>}
                      </td>
                      <td>
                        {changed.length ? (
                          changed.map((k) => LABEL[k] ?? k).join(', ')
                        ) : (
                          <span className="text-muted">No change</span>
                        )}
                      </td>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {fmtStamp(row.createdAt)}
                      </td>
                      <td className="text-muted" style={{ fontSize: 13 }}>
                        {row.note}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
