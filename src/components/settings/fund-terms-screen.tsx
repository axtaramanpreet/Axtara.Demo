'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { Closing, FundInvestor } from '@/adapters/storage/types';
import type { IssuedCall } from '@/engine';
import {
  BLANK_TERMS,
  DEPENDS_ON,
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
  termApplies,
  termsEditImpact,
  type TermsEditImpact,
  termsOn,
  unsetTerms,
  withoutOrphans,
  type FundTerms,
} from '@/engine';
import {
  FIELD,
  FIELDS,
  GROUPS,
  dayCountExample,
  basisInWords,
  display,
  fromDraft,
  toDraft,
  type Field,
  type Group,
} from '@/lib/fund-terms-fields';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox, MultiCombobox, type ComboOption } from '@/components/ui/combobox';
import { InfoTip } from '@/components/ui/info-tip';
import { CURRENCIES } from '@/lib/currencies';
import { Tag } from '@/components/ui/tag';
import { TemplateButtons } from '@/components/ui/template-buttons';
import { useLeaveGuard } from '@/lib/hooks/use-leave-guard';
import { TERMS_SHEET, readTermsTemplate, termsTemplate, type TermsImport, type WorkbookWriter } from '@/adapters/workbook/templates';

/**
 * A fund's terms: what is in force, a form to record a change, and the history.
 *
 * Terms are never edited. "Record a change" adds a row from the date it
 * applies, pre-filled with what is in force, so the accountant changes only
 * what changed. A mistake is corrected the same way — same date, later entry.
 *
 * A term that only means something once another is set — how the fee is
 * charged, who receives late-close interest — appears only once it is set, and
 * is stored as blank otherwise (`withoutOrphans`).
 */

const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<string, string>;

/** The parent a hidden field is waiting for, in words. */
const WAITING: Record<string, string> = {
  feeRateAnnual: 'Set an annual rate to say how the fee is charged.',
  lateCloseInterestRate: 'No interest is charged, so there is nothing more to set.',
};

export function FundTermsScreen({
  fundId,
  fundName,
  history,
  record = { closings: [], calls: [], drafts: [] },
  investors,
  today,
  canWrite,
}: {
  fundId: string;
  fundName: string;
  history: FundTerms[];
  /** What the fund has already done under its terms: an edit is shown against it before it is recorded. */
  record?: { closings: Closing[]; calls: IssuedCall[]; drafts: number[] };
  /** For the rounding plug and the exempt list, which name investors by LP_ID. */
  investors: FundInvestor[];
  /** YYYY-MM-DD, from the server, so the page reads the same on both sides. */
  today: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const inForce = termsOn(history, today);
  const shown = inForce ?? { ...BLANK_TERMS, createdAt: '' };
  const unset = new Set(unsetTerms(shown));
  const scheduled = scheduledAfter(history, today);
  const investorOptions: ComboOption[] = investors.map((i) => ({ value: i.lpId, label: i.name }));
  const names = (id: string) => {
    const name = investors.find((i) => i.lpId === id)?.name;
    return name ? `${id} — ${name}` : id;
  };

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
  // An open form is work not yet recorded.
  useLeaveGuard(open);
  // A correction to what was recorded, or a change from a date — asked once a
  // fund has terms, because the two mean different things for what was issued.
  const [kind, setKind] = useState<'fix' | 'change' | null>(null);
  const [imported, setImported] = useState<{ name: string; filled: number; errors: string[] } | null>(null);

  /** Open the form: what is in force, with a filled-in template on top when one was imported. */
  function start(file?: { name: string; read: TermsImport }) {
    const { terms, suggested: s } = draftTerms(inForce);
    const fromFile = file?.read.draft ?? {};
    setDraft({ ...Object.fromEntries(FIELDS.map((f) => [f.key, toDraft(f, terms[f.key])])), ...fromFile });
    setSuggested(new Set(s.filter((k) => !(k in fromFile))));
    // A fund's first terms must cover its first close, or every fee before them
    // comes out as nothing. Today is almost never that date, so ask.
    setEffectiveFrom(file?.read.effectiveFrom ?? (history.length ? today : ''));
    setNote(file?.read.note ?? '');
    setErrors({});
    setFailure(null);
    setAfterIp(Boolean(file?.read.afterIp));
    setAfterBasis(file?.read.afterIp?.basis ?? 'Invested_Capital');
    setAfterRate(file?.read.afterIp?.rate ?? '');
    setImported(file ? { name: file.name, filled: Object.keys(fromFile).length, errors: file.read.errors } : null);
    // A file says its own date: the start of terms already recorded makes it a
    // correction of them, any other date a change from then.
    const fileDate = file?.read.effectiveFrom;
    setKind(file && history.length ? (fileDate && history.some((t) => t.effectiveFrom === fileDate) ? 'fix' : 'change') : null);
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

  /** The rates as typed so far, to decide which fields apply while editing. */
  const rateOf = (key: 'feeRateAnnual' | 'lateCloseInterestRate') => {
    const r = fromDraft(FIELD[key], draft[key] ?? '');
    return 'value' in r ? (r.value as number | null) : null;
  };
  const draftRates = { feeRateAnnual: rateOf('feeRateAnnual'), lateCloseInterestRate: rateOf('lateCloseInterestRate') };
  const ipEnd = (draft.investmentPeriodEnd ?? '').trim();

  /** The rows this form would record, or what is wrong with it. Records nothing. */
  function collect(): { rows: Omit<FundTerms, 'createdAt'>[]; found: Record<string, string> } {
    const parsed: Record<string, unknown> = {};
    const found: Record<string, string> = {};
    for (const f of FIELDS) {
      if (!termApplies(draftRates, f.key)) continue;
      const r = fromDraft(f, draft[f.key] ?? '');
      if ('error' in r) found[f.key] = r.error;
      else parsed[f.key] = r.value;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) found.effectiveFrom = 'The date these terms apply from.';
    if (history.length && !kind) found.kind = 'Say what kind of edit this is.';

    let afterRateValue: number | null = null;
    if (afterIp) {
      if (!ipEnd) found.afterIp = 'Set when the investment period ends first.';
      else if (effectiveFrom > ipEnd) {
        found.afterIp = 'This change already starts after the investment period. Set the fee above instead.';
      }
      const r = fromDraft(FIELD.feeRateAnnual, afterRate);
      if ('error' in r) found.afterRate = r.error;
      else afterRateValue = r.value as number | null;
    }

    const now = withoutOrphans<Omit<FundTerms, 'createdAt'>>({
      ...BLANK_TERMS,
      ...(parsed as Partial<FundTerms>),
      effectiveFrom,
      note: note.trim() || null,
    });
    // The fee after the investment period only once it can be worked out:
    // this runs on every keystroke, for the impact shown below the form.
    const rows =
      afterIp && !found.afterIp && !found.afterRate
        ? [now, withoutOrphans(afterInvestmentPeriod(now, { feeBasis: afterBasis || null, feeRateAnnual: afterRateValue }))]
        : [now];
    return { rows, found };
  }

  async function save() {
    const { rows, found } = collect();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setFailure(null);
    try {
      await createSupabaseRepository(createBrowserSupabase()).addFundTerms(fundId, rows);
      setOpen(false);
      startRefresh(() => router.refresh());
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not record the terms.');
    } finally {
      setSaving(false);
    }
  }

  /** What this edit would touch, worked out as it is typed. Null until it can be read. */
  const pending = open && history.length ? collect() : null;
  const impact =
    pending && !Object.keys(pending.found).length
      ? termsEditImpact({ terms: history, closings: record.closings, calls: record.calls }, pending.rows, today)
      : null;

  /** Choose what the edit is, and start from the terms it edits. */
  function choose(next: 'fix' | 'change', date = next === 'fix' ? (inForce?.effectiveFrom ?? '') : today) {
    setKind(next);
    setEffectiveFrom(date);
    const base = termsOn(history, date);
    if (base) setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, toDraft(f, base[f.key])])));
    setSuggested(new Set());
    setErrors({});
  }

  function input(f: Field) {
    const value = draft[f.key] ?? '';
    switch (f.kind) {
      case 'currency':
        return (
          <Combobox label={f.label} options={CURRENCIES} value={value || null} onChange={(v) => set(f.key, v ?? '')} placeholder={f.placeholder} />
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
      case 'yesno': {
        const options =
          f.kind === 'yesno'
            ? [
                { value: 'Y', label: 'Yes' },
                { value: 'N', label: 'No' },
              ]
            : f.options ?? [];
        return (
          <select className="cell" aria-label={f.label} value={value} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">Not set</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {value && !options.some((o) => o.value === value) && <option value={value}>Other ({value})</option>}
          </select>
        );
      }
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

  function aside(f: Field): ReactNode {
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
    if (f.key === 'feeDayCount' && draft.feeDayCount) {
      const period = fromDraft(FIELD.feePeriodFraction, draft.feePeriodFraction ?? '');
      const ex = dayCountExample(draft.feeDayCount, draftRates.feeRateAnnual, 'value' in period ? (period.value as number | null) : null);
      return (
        <span className="text-muted mono" style={{ display: 'grid', gap: 2, fontSize: 11 }}>
          <span>{ex.full}</span>
          <span>{ex.part}</span>
        </span>
      );
    }
    return <span className="text-muted">{f.hint}</span>;
  }

  /** A group's fields in the form, with the ones that do not apply yet folded into one line. */
  function formRows(group: Group) {
    const rows: ReactNode[] = [];
    const waiting = new Set<string>();
    for (const f of group.fields) {
      if (!termApplies(draftRates, f.key)) {
        waiting.add(DEPENDS_ON[f.key]!);
        continue;
      }
      rows.push(
        <tr key={f.key}>
          <td style={{ width: 240 }}>
            {f.label}
            <InfoTip label={f.label}>{f.info}</InfoTip>
          </td>
          <td style={{ width: 300, padding: '2px 6px' }}>{input(f)}</td>
          <td style={{ fontSize: 12 }}>{aside(f)}</td>
        </tr>,
      );
    }
    for (const parent of waiting) {
      rows.push(
        <tr key={`waiting-${parent}`}>
          <td colSpan={3} className="text-muted" style={{ fontSize: 13 }}>
            {group.id === 'closings' && parent === 'feeRateAnnual'
              ? 'No management fee, so late investors pay no catch-up fee.'
              : WAITING[parent]}
          </td>
        </tr>,
      );
    }
    return rows;
  }

  function afterIpRows() {
    if (!termApplies(draftRates, 'feeBasis')) return null;
    return (
      <>
        <tr>
          <td colSpan={3} style={{ fontWeight: 600, paddingTop: 16 }}>
            After the investment period
          </td>
        </tr>
        <tr>
          <td>
            The fee changes
            <InfoTip label="The fee changes after the investment period">
              Many LPAs move the fee from commitments to invested capital, lower the rate, or both, once the
              investment period ends. Ticking this records that as its own change, from the day after the period
              ends{ipEnd ? ` (${fmtDate(dayAfter(ipEnd))})` : ''}.
            </InfoTip>
          </td>
          <td style={{ padding: '2px 6px' }}>
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={afterIp} onChange={(e) => setAfterIp(e.target.checked)} />
              {ipEnd ? `From ${fmtDate(dayAfter(ipEnd))}` : 'Set when the investment period ends, above'}
            </label>
          </td>
          <td style={{ fontSize: 12 }}>
            {errors.afterIp ? (
              <span role="alert" style={{ color: 'var(--destructive)' }}>
                {errors.afterIp}
              </span>
            ) : (
              scheduled.length > 0 && <span className="text-muted">A change is already scheduled. Ticking this adds a newer one.</span>
            )}
          </td>
        </tr>
        {afterIp && (
          <>
            <tr>
              <td>
                Charged on, after
                <InfoTip label="Charged on, after the investment period">{FIELD.feeBasis.info}</InfoTip>
              </td>
              <td style={{ padding: '2px 6px' }}>
                <select
                  className="cell"
                  aria-label="Fee basis after the investment period"
                  value={afterBasis}
                  onChange={(e) => setAfterBasis(e.target.value)}
                >
                  {FIELD.feeBasis.options!.map((o) => (
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
                Annual rate, after
                <InfoTip label="Annual rate after the investment period">{FIELD.feeRateAnnual.info}</InfoTip>
              </td>
              <td style={{ padding: '2px 6px' }}>
                <input
                  className="cell"
                  aria-label="Annual rate after the investment period"
                  placeholder="e.g. 1.5%"
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
                  <span className="text-muted">Blank means no fee after the period.</span>
                )}
              </td>
            </tr>
          </>
        )}
      </>
    );
  }

  /** A group as it reads when not editing. */
  function viewRows(group: Group) {
    const out: ReactNode[] = [];
    for (const f of group.fields) {
      // No fee, or no interest: the rate reads "None" and nothing under it applies.
      if (!termApplies(shown, f.key)) continue;
      const empty = f.key === 'feeRateAnnual' || f.key === 'lateCloseInterestRate' ? 'None' : null;
      out.push(
        <dt key={`${f.key}-t`}>
          {f.label}
          <InfoTip label={f.label}>{f.info}</InfoTip>
        </dt>,
        <dd key={`${f.key}-d`}>
          {shown[f.key] === null && empty ? (
            <span className="text-muted">{empty}</span>
          ) : unset.has(f.key) ? (
            // Blank is shown as blank. This page never pretends to a value nobody chose.
            <Tag tone="warn">Not set</Tag>
          ) : (
            display(f, shown[f.key], names) || <span className="text-muted">None</span>
          )}
        </dd>,
      );
    }
    if (group.id === 'fee' && termApplies(shown, 'feeBasis')) {
      const end = shown.investmentPeriodEnd;
      const after = end ? termsOn(history, dayAfter(end)) : null;
      const changes = after && (after.feeRateAnnual !== shown.feeRateAnnual || after.feeBasis !== shown.feeBasis);
      out.push(
        <dt key="after-t">
          After the investment period
          <InfoTip label="After the investment period">What the fee becomes once the investment period ends, if the LPA changes it.</InfoTip>
        </dt>,
        <dd key="after-d">
          {changes && after ? (
            after.feeRateAnnual ? (
              `From ${fmtDate(after.effectiveFrom)}: ${pct(after.feeRateAnnual)} a year on ${basisInWords(after.feeBasis)}`
            ) : (
              `From ${fmtDate(after.effectiveFrom)}: no fee`
            )
          ) : (
            <span className="text-muted">{end ? 'No change recorded' : 'Set when the investment period ends'}</span>
          )}
        </dd>,
      );
    }
    return out;
  }

  // Newest first, and which row each was superseded by, for the history list.
  const ordered = [...history].sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom ? b.createdAt.localeCompare(a.createdAt) : b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const chronological = [...ordered].reverse();

  return (
    <div style={{ maxWidth: 1000, opacity: refreshing ? 0.6 : 1, transition: 'opacity 120ms' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1>Fund terms</h1>
          <p className="text-muted" style={{ maxWidth: 620, textWrap: 'pretty' }}>
            {inForce
              ? `In force since ${fmtDate(inForce.effectiveFrom)}. Every call, closing and fee period reads these. Changing a term records it from a date; nothing earlier is rewritten.`
              : 'Nothing recorded yet. Record the terms from the LPA first: closings, calls and fees all read them.'}
          </p>
        </div>
        {canWrite && !open && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TemplateButtons
              fileName={`${fundName} — fund terms.xlsx`}
              build={(XLSX) => termsTemplate(XLSX as unknown as WorkbookWriter, fundName, inForce)}
              onImport={(XLSX, wb, name) => {
                const sheet = wb.Sheets[TERMS_SHEET];
                const grid = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][]) : null;
                start({ name, read: readTermsTemplate(grid) });
              }}
            />
            {/* A fund with no terms yet has the button in the card below, beside what it is for. */}
            {history.length > 0 && (
              <Button variant="primary" onClick={() => start()}>
                {inForce ? 'Edit terms' : 'Record the fund’s terms'}
              </Button>
            )}
          </div>
        )}
      </div>

      {!canWrite && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You can see these terms but not change them.
        </p>
      )}

      {open ? (
        <>
          <Card title={inForce ? 'Edit terms' : 'Record the fund’s terms'} style={{ marginTop: 20 }} bodyPadding="16px">
            {imported && (
              <div style={{ display: 'grid', gap: 4, fontSize: 13, marginBottom: 10 }}>
                <span>
                  <Tag tone="accent">Imported</Tag> {imported.filled} term{imported.filled === 1 ? '' : 's'} from{' '}
                  {imported.name}. Check them below, then Record — nothing is saved until you do.
                </span>
                {imported.errors.map((e) => (
                  <span key={e} style={{ color: 'var(--destructive)' }}>
                    Not imported — {e}
                  </span>
                ))}
              </div>
            )}
            {history.length > 0 && (
              <fieldset className="edit-kind" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
                <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>What kind of edit?</legend>
                <label className={['edit-option', kind === 'fix' ? 'on' : ''].filter(Boolean).join(' ')}>
                  <input type="radio" name="edit-kind" checked={kind === 'fix'} onChange={() => choose('fix')} />
                  <span>
                    <strong>Fix a mistake</strong>
                    <span className="text-muted">
                      What was recorded was wrong — the LPA always said otherwise. Applies from when those terms started.
                    </span>
                  </span>
                </label>
                <label className={['edit-option', kind === 'change' ? 'on' : ''].filter(Boolean).join(' ')}>
                  <input type="radio" name="edit-kind" checked={kind === 'change'} onChange={() => choose('change')} />
                  <span>
                    <strong>The terms change from a date</strong>
                    <span className="text-muted">
                      The LPA was amended, or a change it already sets out takes effect. Before that date, nothing moves.
                    </span>
                  </span>
                </label>
                {errors.kind && (
                  <span role="alert" style={{ color: 'var(--destructive)', fontSize: 12 }}>
                    {errors.kind}
                  </span>
                )}
              </fieldset>
            )}
            {(history.length === 0 || kind) && (
              <>
                <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
                  {kind === 'fix'
                    ? 'Pre-filled with the terms being corrected. Change what was wrong.'
                    : kind === 'change'
                      ? 'Pre-filled with what is in force. Change only what changes, and say from when.'
                      : 'Fill these in from the LPA. A common choice is suggested where there is one — check each. Anything you leave blank can be added later as a change.'}
                </p>
                <table className="table">
                  <tbody>
                    <tr>
                      <td style={{ width: 240, fontWeight: 600 }}>
                        {kind === 'fix' ? 'Terms being corrected' : 'Applies from'}
                        <InfoTip label="Applies from">
                          The first day these terms apply. Nothing already sent, finalised or recorded is rewritten; what
                          this touches is shown below before you record it.
                        </InfoTip>
                      </td>
                      <td style={{ width: 300, padding: '2px 6px' }}>
                        {kind === 'fix' ? (
                          <select className="cell" aria-label="Applies from" value={effectiveFrom} onChange={(e) => choose('fix', e.target.value)}>
                            {[...new Set(history.map((t) => t.effectiveFrom))].sort().map((d) => (
                              <option key={d} value={d}>
                                In force from {fmtDate(d)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input className="cell" type="date" aria-label="Applies from" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {errors.effectiveFrom ? (
                          <span role="alert" style={{ color: 'var(--destructive)' }}>
                            {errors.effectiveFrom}
                          </span>
                        ) : history.length ? null : (
                          <span className="text-muted">The date of the LPA, or the first close — no later, or fees before it come to nothing.</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </Card>

          {(history.length === 0 || kind) && (
          <>
          {GROUPS.map((group) => (
            <Card key={group.id} title={group.title} subtitle={group.subtitle} style={{ marginTop: 16 }} bodyPadding="8px 16px 12px">
              <table className="table">
                <tbody>
                  {formRows(group)}
                  {group.id === 'fee' && afterIpRows()}
                </tbody>
              </table>
            </Card>
          ))}

          <Card style={{ marginTop: 16 }} bodyPadding="12px 16px">
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span>
                Note
                <InfoTip label="Note">Why the terms changed, and where it says so — a clause of the LPA, a side letter, an amendment.</InfoTip>
              </span>
              <input
                className="cell"
                aria-label="Note"
                placeholder="e.g. LPA §8.1, fee step-down after the investment period"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ border: '1px solid var(--border)' }}
              />
            </label>
          </Card>

          {impact && <EditImpact impact={impact} drafts={record.drafts} />}
          </>
          )}

          {/* Always in reach: the form is long, and Record is the only way to keep it. */}
          <div className="action-bar">
            {failure ? (
              <span role="alert" style={{ color: 'var(--destructive)' }}>
                {failure}
              </span>
            ) : Object.keys(errors).length > 0 ? (
              <span role="status" style={{ color: 'var(--destructive)' }}>
                {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? ' needs' : 's need'} a look — marked above.
              </span>
            ) : (
              <span className="text-muted">Nothing is recorded until you press Record.</span>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              Record
            </Button>
          </div>
        </>
      ) : !inForce && history.length === 0 ? (
        <Card style={{ marginTop: 20, maxWidth: 680 }} bodyPadding="24px">
          <h3 style={{ marginTop: 0 }}>Start with the LPA</h3>
          <p className="text-muted" style={{ textWrap: 'pretty' }}>
            The management fee, the investment period, interest on late closings, who signs the notices and where
            investors wire money. Every closing, call and fee period reads them, so they come first. Type them in, or fill
            in the template and import it.
          </p>
          {canWrite && (
            <Button variant="primary" onClick={() => start()}>
              Record the fund&rsquo;s terms
            </Button>
          )}
        </Card>
      ) : (
        <>
          {GROUPS.map((group) => (
            <Card key={group.id} title={group.title} subtitle={group.subtitle} style={{ marginTop: 20 }}>
              <dl className="kv" style={{ gridTemplateColumns: '260px 1fr', padding: '14px 16px' }}>
                {viewRows(group)}
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
                              const f = FIELD[k as keyof typeof FIELD];
                              return f ? `${f.label}: ${display(f, row[f.key], names) || 'cleared'}` : String(k);
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

      {ordered.length > 0 && (
      <Card title="History" subtitle="every change, newest first" style={{ marginTop: 20 }}>
        {(
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
                        {fmtDate(row.effectiveFrom)} {row === inForce && <Tag tone="accent">In force</Tag>}
                        {row.effectiveFrom > today && <Tag>Scheduled</Tag>}
                        {superseded && <Tag>Corrected</Tag>}
                      </td>
                      <td>{changed.length ? changed.map((k) => LABEL[k] ?? k).join(', ') : <span className="text-muted">No change</span>}</td>
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
      )}
    </div>
  );
}

/** What an edit touches, shown before it is recorded. Nothing issued is rewritten. */
function EditImpact({ impact, drafts }: { impact: TermsEditImpact; drafts: number[] }) {
  const nothing = !impact.issuedCalls.length && !impact.closings.length && !impact.billedPeriods.length && !drafts.length;
  return (
    <Card
      title="What this edit touches"
      subtitle={`from ${fmtDate(impact.from)}${impact.to ? ` to ${fmtDate(impact.to)}` : ' onwards'}`}
      style={{ marginTop: 16 }}
      bodyPadding="12px 16px"
    >
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }}>
        {nothing && <li>Nothing has been issued or billed under these terms yet.</li>}
        {impact.issuedCalls.length > 0 && (
          <li>
            <strong>Calls already sent stay exactly as sent:</strong>{' '}
            {impact.issuedCalls.map((c) => `Call No. ${c.callNo} (${fmtDate(c.callDate)})`).join(', ')}. Investors have these
            notices; a difference is put right on a later call.
          </li>
        )}
        {impact.closings.length > 0 && (
          <li>
            <strong>Finalised closings stay as finalised:</strong> {impact.closings.map((c) => `Closing ${c.closingNo}`).join(', ')}.
          </li>
        )}
        {impact.billedPeriods.length > 0 && (
          <li>
            <strong>Billed fees that change</strong> — each will show a true-up on Management fees:
            <table className="table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Billed</th>
                  <th style={{ textAlign: 'right' }}>Becomes</th>
                  <th style={{ textAlign: 'right' }}>True-up</th>
                </tr>
              </thead>
              <tbody>
                {impact.billedPeriods.map((f) => (
                  <tr key={f.from}>
                    <td>{f.label}</td>
                    <td className="num">{fmt(f.billed)}</td>
                    <td className="num">{fmt(f.becomes)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {f.trueUp > 0 ? `+${fmt(f.trueUp)}` : `−${fmt(-f.trueUp)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
        )}
        {drafts.length > 0 && (
          <li>
            <strong>Draft calls follow the new terms</strong> when next opened and saved:{' '}
            {drafts.map((n) => `Call No. ${n}`).join(', ')}.
          </li>
        )}
      </ul>
    </Card>
  );
}
