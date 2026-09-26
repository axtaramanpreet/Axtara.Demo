'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  COMPONENT_COLUMNS,
  FEE_FIELDS,
  LP_COLUMNS,
  OFFSET_COLUMNS,
  SETUP_FIELDS,
  TRANSFER_COLUMNS,
} from '@/adapters/workbook/template-layout';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { createSupabaseRepository } from '@/adapters/storage/supabase-repository';
import type { CallDetail, CallSources, FundInvestor } from '@/adapters/storage/types';
import { identityFromProfiles } from '@/lib/investor-profile';
// Type-only, so this does not pull SheetJS into the bundle; the module itself
// is imported on demand when a workbook is actually opened.
import type { WorkbookLike, WorkbookReader } from '@/adapters/workbook/parse-workbook';
import { applyFundTerms, buildEqualizationSchedule, buildFeeSchedule, callFeePeriod, categoryOf, compute, defaultFeePeriods, equalizationOwed, equalizationScheduleDifferences, unsettledClosings, feeAlreadyCharged, feeFraction, feeOwed, feeScheduleDifferences, positionFromRecord, scheduleLabel, type PeriodOwed, fmt, fmtDate, fundRegister, num, pct, registerDifferences, serialToISO, termsOn, type ComputeResult, type FundHistory, type FundTerms } from '@/engine';
import { nextCallFrom } from '@/engine/carry-forward';
import type { CallModel, ComponentRow, LPRow, OffsetRow, TransferRow } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Datalists } from './datalists';
import { EditableTable } from './editable-table';
import { FieldTable } from './field-table';
import { ProcessingOverlay, REVIEW_STEPS, UPLOAD_STEPS } from './processing-overlay';
import { SourceStep } from './source-step';
import { STEPS, Stepper, type StepId } from './stepper';
import { useLeaveGuard } from '@/lib/hooks/use-leave-guard';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * A call with the fund's terms in force on its date applied, and a sentence
 * saying what that changed — or null when it changed nothing.
 */
function withTerms(
  model: CallModel,
  fundTerms: FundTerms[],
  today: string,
  readOnly: boolean,
): { model: CallModel; message: string | null } {
  if (readOnly) return { model, message: null };
  const on = serialToISO(model.setup.Call_Date) || today;
  const { model: next, changed } = applyFundTerms(model, termsOn(fundTerms, on));
  if (!changed.length) return { model: next, message: null };
  const seen = new Set<string>();
  const lines = changed
    .filter((c) => !seen.has(c.key) && Boolean(seen.add(c.key)))
    .map((c) => `${c.key} ${String(c.was ?? '') || 'blank'} → ${String(c.now ?? '')}`);
  return { model: next, message: `Updated from the fund's terms in force on ${fmtDate(on)}: ${lines.join(', ')}.` };
}

/**
 * A call with the later closings' equalization it must settle, worked out from
 * the record — never typed — so it follows every edit. Null message when
 * nothing changed.
 */
function withEqualization(
  model: CallModel,
  history: FundHistory,
  callNo: number,
  today: string,
  readOnly: boolean,
): { model: CallModel; message: string | null } {
  if (readOnly) return { model, message: null };
  const on = serialToISO(model.setup.Call_Date) || today;
  const owed = equalizationOwed(history, on, callNo);
  const had = model.equalizationSchedule ?? null;
  if (!owed.length && !had) return { model, message: null };
  const fresh = buildEqualizationSchedule(owed);
  const next = fresh.length ? fresh : null;
  if (equalizationScheduleDifferences(had ?? [], fresh).length === 0) return { model, message: null };
  return {
    model: { ...model, equalizationSchedule: next },
    message: next
      ? `Equalization carried from ${next.map((e) => `Closing ${e.closingNo}`).join(', ')}: earlier calls on Call components, the catch-up fee on Management fee.`
      : 'No equalization is owed on this call any more, so it was taken off.',
  };
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SetupScreen({
  call,
  fundId,
  previousCall,
  fundTerms,
  record,
  investors,
  today,
}: {
  call: CallDetail;
  fundId: string;
  /** The call before this one, for carrying the register forward. */
  previousCall?: CallDetail | null;
  /** The fund's terms, every row. The ones in force on the call date apply. */
  fundTerms: FundTerms[];
  /** The fund's closings and earlier issued calls, for reading the register from the record. */
  record: Omit<FundHistory, 'terms'>;
  /** The investor register: who each investor is, which a call's register takes rather than sets. */
  investors: FundInvestor[];
  /** YYYY-MM-DD, from the server: the date terms are read on before the call has one. */
  today: string;
}) {
  const router = useRouter();
  const repo = useMemo(() => createSupabaseRepository(createBrowserSupabase()), []);

  const readOnlyAtLoad = call.lockedAt !== null;
  const [initial] = useState(() => {
    const hist = { terms: fundTerms, ...record };
    const withFee = (): { model: CallModel; message: string | null } => {
      const applied = withTerms(call.model, fundTerms, today, readOnlyAtLoad);
      if (readOnlyAtLoad || applied.model.feeSchedule) return applied;
      // A fund with closings bills its fee period by period. A call that has not
      // said which periods starts with the usual one, marked to check and save.
      const on = serialToISO(applied.model.setup.Call_Date) || today;
      if (!positionFromRecord(hist, on)) return applied;
      const owed = feeOwed(hist, on, call.callNo);
      const schedule = buildFeeSchedule(owed, defaultFeePeriods(owed, on, termsOn(fundTerms, on)?.feeTiming ?? null));
      const note = schedule.length
        ? `Fee periods chosen: ${scheduleLabel(schedule)}. Check them on the Management fee step, then Save.`
        : "No fee is owed for this call's period. Pick periods on the Management fee step if it should bill any.";
      return { model: { ...applied.model, feeSchedule: schedule }, message: [applied.message, note].filter(Boolean).join(' ') };
    };
    const fee = withFee();
    const eq = withEqualization(fee.model, hist, call.callNo, today, readOnlyAtLoad);
    return { model: eq.model, message: [fee.message, eq.message].filter(Boolean).join(' ') || null };
  });
  const [model, setModel] = useState<CallModel>(initial.model);
  const [sources, setSources] = useState<CallSources>(call.sources);
  const [step, setStep] = useState<StepId>(call.sources.lps === 'empty' ? 'source' : 'setup');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [status, setStatus] = useState<string | null>(initial.message);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<{ title: string; steps: string[]; then: () => void } | null>(
    null,
  );

  // Inputs are frozen once a notice has gone out; the database enforces it too.
  const readOnly = readOnlyAtLoad;

  // Nothing here saves by itself: these are the figures investors are asked
  // to wire against, so a change is kept only when someone presses Save. The
  // fund's terms changing the call as it loads counts as a change to save.
  const [unsaved, setUnsaved] = useState(initial.message !== null && !readOnlyAtLoad);
  useLeaveGuard(unsaved);

  /**
   * The fund's terms in force on the call date, put into the call.
   *
   * Fund-level fields — currency, fee, rounding, who signs — are set once in
   * Settings, so a draft call follows them rather than carrying its own copy
   * that can drift. Only terms Settings actually has are applied and locked;
   * the rest stay the call's to type. An issued call is left exactly as sent.
   *
   * Applied wherever the call changes — as it loads, on every edit (a new call
   * date can bring different terms into force), and when a workbook, the
   * template or the previous call replaces it — so the model is never out of
   * step with Settings, and no render has to correct another.
   */
  const termsDate = serialToISO(model.setup.Call_Date) || today;
  const termsForCall = termsOn(fundTerms, termsDate);
  const lockedCells = readOnly ? new Set<string>() : applyFundTerms(model, termsForCall).locked;
  const lockedFor = (step: 'setup' | 'fee') =>
    new Set([...lockedCells].filter((k) => k.startsWith(`${step}.`)).map((k) => k.slice(step.length + 1)));

  /** Save what is on screen. Only ever from the Save button. */
  async function save() {
    setSaveState('saving');
    setError(null);
    try {
      await repo.saveCall(call.id, model, sources);
      setSaveState('saved');
      setUnsaved(false);
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  /**
   * Record an edit.
   *
   * Editing a step marks it Manual: whatever it said before, these figures were
   * typed by a person, and the stepper should say so rather than still claiming
   * they came from a workbook.
   */
  function edit(next: Partial<CallModel>, touched?: keyof CallSources) {
    setUnsaved(true);
    setSaveState('idle');
    const applied = withTerms({ ...model, ...next }, fundTerms, today, readOnly);
    const settled = withEqualization(applied.model, { terms: fundTerms, ...record }, call.callNo, today, readOnly);
    setModel(settled.model);
    const message = [applied.message, settled.message].filter(Boolean).join(' ');
    if (message) setStatus(message);
    if (touched) setSources((s) => ({ ...s, [touched]: 'manual' }));
  }

  function replaceModel(next: CallModel, nextSources: CallSources, message: string) {
    setUnsaved(true);
    setSaveState('idle');
    // A workbook, the template or the previous call carries its own fund-level
    // figures; where Settings has a term, Settings wins, and the message says
    // what it replaced so nobody is surprised by a fee they did not upload.
    // A workbook or the template knows nothing of the fund's fee periods; the
    // ones this call already names stay.
    const applied = withTerms({ ...next, feeSchedule: next.feeSchedule ?? model.feeSchedule }, fundTerms, today, readOnly);
    const settled = withEqualization(applied.model, { terms: fundTerms, ...record }, call.callNo, today, readOnly);
    setModel(settled.model);
    setSources(nextSources);
    const said = [message, applied.message, settled.message].filter(Boolean).join(' ');
    setStatus(`${said} Check it, then Save.`);
  }

  async function onWorkbook(file: File) {
    setError(null);
    try {
      // SheetJS is large and only needed here, so it is loaded on demand
      // rather than shipped to every page.
      const [XLSX, workbook] = await Promise.all([
        import('xlsx'),
        import('@/adapters/workbook/parse-workbook'),
      ]);
      // The adapter describes only the slice of SheetJS it uses, which its
      // fuller signature does not structurally satisfy. Cast at this one
      // boundary rather than widening the adapter to accept anything.
      const parsed = workbook.parseWorkbook(
        XLSX as unknown as WorkbookReader,
        XLSX.read(await file.arrayBuffer(), { type: 'array' }) as WorkbookLike,
        model,
      );

      // The workbook's own Call_Number is ignored: this call already has a
      // number that is unique within the fund, and renumbering it here would
      // collide with an existing call.
      parsed.setup.Call_Number = model.setup.Call_Number;
      // Nor its fund name: the notice is headed with the fund this call belongs to.
      parsed.setup.Fund_Name = model.setup.Fund_Name;
      // "deals" or "Investment" is the Deal category; anything else is left as
      // written, and the call cannot be approved until someone picks.
      parsed.components = parsed.components.map((c) => ({ ...c, Category: categoryOf(c.Category) ?? c.Category }));

      // Who each known investor is comes from the investor register, not the
      // workbook; what differed is said, not silently kept or lost.
      const identity = identityFromProfiles(parsed.lps, investors);
      parsed.lps = identity.lps;

      const nextSources: CallSources = {
        setup: 'excel',
        lps: 'excel',
        components: 'excel',
        fee: 'excel',
        transfers: 'excel',
      };

      setOverlay({
        ...UPLOAD_STEPS(file.name),
        then: () => {
          setOverlay(null);
          replaceModel(
            parsed,
            nextSources,
            [
              `Read ${file.name} — ${parsed.lps.length} investors and ${parsed.components.length} components.`,
              identity.notes.length ? `Names kept from the investor register: ${identity.notes.join(' ')}` : '',
              fundTerms.length ? 'Fund-level fields follow Fund terms, not the workbook.' : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
          setStep('setup');
        },
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not read that workbook: ${e.message}`
          : 'Could not read that workbook.',
      );
    }
  }

  function onCarryForward() {
    if (!previousCall) return;
    const carried = nextCallFrom(previousCall.model);
    replaceModel(
      { ...carried, setup: { ...carried.setup, Call_Number: model.setup.Call_Number } },
      { ...sources, setup: 'carried', lps: 'carried', fee: 'carried' },
      `Register carried forward from Call No. ${previousCall.callNo}: closing paid-in and unfunded are now the opening balances.`,
    );
    setStep('lps');
  }

  /**
   * The register from the fund's record: every closing, issued call and
   * equalization, as at this call's date. What a fund with closings uses
   * instead of carrying forward, which would miss a later close.
   */
  function onFundRegister() {
    setError(null);
    const on = serialToISO(model.setup.Call_Date) || today;
    const register = fundRegister({ terms: fundTerms, ...record }, on, previousCall?.model ?? null);
    if (!register.ok) {
      setError(
        `The fund's record disagrees with itself, so the register can't be read from it. ${register.problems.join(' ')} A transfer inside a call is the usual cause: record the change as a closing, or enter the register by hand.`,
      );
      return;
    }
    const base = previousCall ? nextCallFrom(previousCall.model) : model;
    replaceModel(
      { ...base, setup: { ...base.setup, Call_Number: model.setup.Call_Number }, lps: register.lps, components: [], transfers: [] },
      previousCall
        ? { ...sources, setup: 'carried', lps: 'carried', fee: 'carried', components: 'manual', transfers: 'manual' }
        : { ...sources, lps: 'carried' },
      `Register read from the fund's record as at ${fmtDate(on)}: ${register.lps.length} investors, with paid-in and unfunded after every issued call and closing.`,
    );
    setStep('lps');
  }

  // Once the fund has closings, the record says who is in the fund and what
  // each has paid. A register — uploaded, typed or carried — that says
  // otherwise would put this call, and every one after it, on the wrong
  // figures, so every difference is listed, and approving is refused until
  // there are none.
  const callOn = serialToISO(model.setup.Call_Date) || today;
  const differences = model.lps.length ? registerDifferences({ terms: fundTerms, ...record }, model.lps, callOn) : [];
  // The fee period this call's fee covers, and any earlier sent call that
  // already charged it — so a second call in one quarter does not bill it twice.
  // A fund with closings bills the fee period by period; one without charges
  // rate × share of a year, and can leave it out. Never both on one screen.
  const byPeriod = positionFromRecord({ terms: fundTerms, ...record }, callOn) !== null;
  const owed: PeriodOwed[] = byPeriod ? feeOwed({ terms: fundTerms, ...record }, callOn, call.callNo) : [];
  const schedule = model.feeSchedule ?? [];
  const chosen = new Set(schedule.map((e) => `${e.from}|${e.to}`));
  const freshSchedule = byPeriod ? buildFeeSchedule(owed, schedule) : [];
  const staleFee = byPeriod && !readOnly ? feeScheduleDifferences(schedule, freshSchedule) : [];
  const toggleFeePeriod = (o: PeriodOwed, on: boolean) => {
    const periods = owed.filter((x) => (x === o ? on : chosen.has(`${x.period.from}|${x.period.to}`))).map((x) => x.period);
    edit({ feeSchedule: buildFeeSchedule(owed, periods) }, 'fee');
  };
  const chargesFee = String(model.setup.Charge_Mgmt_Fee ?? '').trim().toUpperCase() !== 'N';
  const feePeriod = callFeePeriod(callOn, feeFraction(model));
  const chargedBefore = !byPeriod && chargesFee && feePeriod ? feeAlreadyCharged(record.calls, feePeriod, call.callNo) : [];
  const setChargesFee = (on: boolean) => edit({ setup: { ...model.setup, Charge_Mgmt_Fee: on ? 'Y' : 'N' } }, 'fee');

  // A later closing nobody has yet said how to settle holds this call back.
  const unsettled = readOnly ? [] : unsettledClosings({ terms: fundTerms, ...record }, callOn);

  // A fund with terms, but none yet in force on this call's date.
  const noTermsOnDate = !readOnly && fundTerms.length > 0 && !termsForCall;

  /** Put the register the record gives in place of this one, leaving the rest of the call as it is. */
  function useFundRegisterOnly() {
    const register = fundRegister({ terms: fundTerms, ...record }, callOn, previousCall?.model ?? null);
    if (!register.ok) {
      setError(`The fund's record disagrees with itself: ${register.problems.join(' ')}`);
      return;
    }
    edit({ lps: register.lps });
    setSources((s) => ({ ...s, lps: 'carried' }));
    setStatus(`Register replaced with the fund's, as at ${fmtDate(callOn)}: ${register.lps.length} investors. Check it, then Save.`);
  }

  /**
   * The input workbook for this call, with everything it already knows: the
   * terms, and — for a fund with closings and a call with no register yet —
   * the fund's investors, so an uploaded register cannot disagree with them.
   */
  async function onDownloadTemplate() {
    const [XLSX, { callTemplate }] = await Promise.all([import('xlsx'), import('@/adapters/workbook/templates')]);
    let filled = model;
    if (!model.lps.length && record.closings.some((c) => c.finalised)) {
      const on = serialToISO(model.setup.Call_Date) || today;
      const register = fundRegister({ terms: fundTerms, ...record }, on, previousCall?.model ?? null);
      if (register.ok) filled = { ...model, lps: register.lps };
    }
    const book = callTemplate(XLSX as unknown as import('@/adapters/workbook/templates').WorkbookWriter, filled);
    XLSX.writeFile(book as import('xlsx').WorkBook, `Capital_Call_${String(model.setup.Call_Number || call.callNo).padStart(2, '0')}_Input.xlsx`, { compression: true });
  }

  function onReviewAllocation() {
    setOverlay({
      ...REVIEW_STEPS(model.setup.Call_Number ?? ''),
      then: () => router.push(`/funds/${fundId}/calls/${call.id}`),
    });
  }

  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onDelete() {
    setConfirmDelete(false);
    try {
      await repo.deleteCall(call.id);
      router.push(`/funds/${fundId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this call.');
    }
  }

  const componentTotal = model.components.reduce((s, c) => s + num(c.Total_Amount), 0);
  // What the call comes to as it stands: the fee each investor is charged is
  // shown on the fee step, before anyone reviews the allocation.
  const result = useMemo(() => compute(model), [model]);
  const lpNames = useMemo(() => new Map(model.lps.map((l) => [String(l.LP_ID), String(l.LP_Name ?? '')])), [model.lps]);
  const feeOnly = componentTotal === 0 && result.totals.feeNet > 0;
  // Who can take the rounding remainder: this call's register, or — before it
  // is filled in, as Fund setup comes first — the fund's investors.
  const onRegister = model.lps.filter((l) => String(l.LP_ID ?? '').trim());
  const plugOptions = onRegister.length
    ? onRegister.map((l) => ({ value: String(l.LP_ID), label: String(l.LP_Name ?? l.LP_ID) }))
    : investors.map((i) => ({ value: i.lpId, label: i.name }));
  // Names used on the last call, so one investment keeps one name across calls.
  const componentNames = [...new Set((previousCall?.model.components ?? []).map((c) => String(c.Component_Name ?? '').trim()).filter(Boolean))];
  const offsetTotal = (model.fee.offsets ?? []).reduce((s, o) => s + num(o.Amount), 0);

  return (
    <>
      <Datalists />

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete Capital Call No. ${String(model.setup.Call_Number ?? call.callNo)}?`}
          confirm="Delete call"
          danger
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        >
          <p style={{ margin: 0 }}>Its inputs are removed. Nothing has been sent for it, so no investor has seen it.</p>
        </ConfirmDialog>
      )}

      {overlay && (
        <ProcessingOverlay title={overlay.title} steps={overlay.steps} onDone={overlay.then} />
      )}

      <div style={{ maxWidth: 1200 }}>
        <Link href={`/funds/${fundId}`} className="crumb">
          ‹ All calls
        </Link>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 20,
            flexWrap: 'wrap',
            marginTop: 10,
          }}
        >
          <div>
            <h1>Set up Capital Call No. {String(model.setup.Call_Number ?? '')}</h1>
            <p className="text-muted">
              {componentTotal > 0
                ? `${model.components.length} components totalling ${model.setup.Reporting_Currency} ${fmt(componentTotal)} before the management fee.`
                : feeOnly
                  ? `Management fee only: ${model.setup.Reporting_Currency} ${fmt(result.totals.feeNet)}${
                      result.equalization ? `, plus ${fmt(result.equalization.total)} of equalization, net` : ''
                    }. Add components if anything else is being called for.`
                : 'Nothing to call yet — add components, or start from a workbook.'}
            </p>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <SaveIndicator state={saveState} unsaved={unsaved} readOnly={readOnly} />
            {!readOnly && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete call
              </Button>
            )}
            {!readOnly && (
              <Button onClick={save} disabled={!unsaved} loading={saveState === 'saving'}>
                Save
              </Button>
            )}
            <Button
              variant="primary"
              onClick={onReviewAllocation}
              disabled={unsaved}
              title={unsaved ? 'Save your changes first: the allocation is worked out from what is saved.' : undefined}
            >
              Review allocation ›
            </Button>
          </div>
        </div>

        {status && (
          <div
            data-noprint="1"
            style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '20px 0 0', fontSize: 13 }}
          >
            <Tag tone="accent">Updated</Tag>
            <span>{status}</span>
            <button type="button" onClick={() => setStatus(null)} style={dismissStyle}>
              dismiss
            </button>
          </div>
        )}

        {error && (
          <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13 }}>
            {error}
          </p>
        )}

        {!readOnly && differences.length > 0 && (
          <div role="status" style={{ marginTop: 12, fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag tone="danger">Register differs from the fund&rsquo;s record</Tag>
              <span>
                {differences.length} difference{differences.length === 1 ? '' : 's'}. This call cannot be approved until
                there are none.
              </span>
              <Button small variant="primary" onClick={useFundRegisterOnly} style={{ marginLeft: 'auto' }}>
                Use the fund&rsquo;s register
              </Button>
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {differences.slice(0, 12).map((d) => (
                <li key={`${d.lpId}-${d.kind}`}>{d.text}</li>
              ))}
              {differences.length > 12 && <li className="text-muted">and {differences.length - 12} more</li>}
            </ul>
            <p className="text-muted" style={{ margin: '8px 0 0', textWrap: 'pretty' }}>
              Someone new, or a change of commitment, is recorded as a closing first; balances come from the calls and
              closings already on record.
            </p>
          </div>
        )}

        {staleFee.length > 0 && (
          <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
            <Tag tone="danger">Fee out of date</Tag>
            <span style={{ textWrap: 'pretty' }}>
              What this call bills for {scheduleLabel(schedule)} is no longer what is owed — another call billed it, or the
              record changed. It cannot be approved like this.
            </span>
            <Button small variant="primary" onClick={() => edit({ feeSchedule: freshSchedule }, 'fee')}>
              Update the fee
            </Button>
          </div>
        )}

        {!readOnly && chargedBefore.length > 0 && feePeriod && (
          <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
            <Tag tone="danger">Fee charged twice</Tag>
            <span style={{ textWrap: 'pretty' }}>
              {feePeriod.label}&rsquo;s management fee was already charged on{' '}
              {chargedBefore.map((c) => `Call No. ${c.callNo} (${fmt(c.fee)})`).join(', ')}. This call cannot be approved
              while it charges it again.
            </span>
            <Button small variant="primary" onClick={() => setChargesFee(false)}>
              Leave the fee out of this call
            </Button>
          </div>
        )}

        {unsettled.length > 0 && (
          <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
            <Tag tone="danger">Equalization not settled</Tag>
            <span style={{ textWrap: 'pretty' }}>
              {unsettled.map((c) => `Closing ${c.closingNo}`).join(', ')} moved money between investors, and nobody has said
              how it is settled. This call cannot be approved until that is chosen.
            </span>
            <Link href={`/funds/${fundId}/closings`} className="btn btn-secondary btn-sm">
              Choose on Closings
            </Link>
          </div>
        )}

        {noTermsOnDate && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, fontSize: 13 }}>
            <Tag tone="danger">No fund terms on this date</Tag>
            <span style={{ textWrap: 'pretty' }}>
              The fund&rsquo;s terms start after {fmtDate(callOn)}, so this call has no fee, currency or signatory to
              follow. Change the call date, or record the terms from an earlier date in{' '}
              <Link href={`/funds/${fundId}/settings`}>Fund terms</Link>.
            </span>
          </div>
        )}

        {readOnly && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 20, fontSize: 13 }}>
            <Tag tone="danger">Issued</Tag>
            <span>
              Notices have been sent for this call, so its inputs are locked. Raise a new call to
              correct anything.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 32, marginTop: 24, alignItems: 'flex-start' }}>
          <Stepper
            current={step}
            onSelect={setStep}
            sources={sources}
            details={{
              setup: !model.setup.Call_Date || !model.setup.Payment_Due_Date ? 'add the call dates' : undefined,
              lps: model.lps.length ? `${model.lps.length} investors` : undefined,
              components: !model.components.length && feeOnly
                ? 'none — fee only'
                : model.components.length
                ? `${model.components.length} items · ${model.setup.Reporting_Currency} ${fmt(componentTotal, 0)}`
                : undefined,
              fee: offsetTotal ? `offsets ${fmt(offsetTotal, 0)}` : undefined,
              transfers: model.transfers.length ? `${model.transfers.length} pending` : undefined,
            }}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            {step === 'source' && (
              <SourceStep
                readOnly={readOnly}
                carryForwardFrom={previousCall?.callNo}
                onWorkbook={onWorkbook}
                onCarryForward={onCarryForward}
                onFundRegister={record.closings.some((c) => c.finalised) ? onFundRegister : undefined}
                onDownloadTemplate={onDownloadTemplate}
                onManual={() => {
                  replaceModel(
                    { ...model, lps: [], components: [], transfers: [] },
                    { ...sources, lps: 'manual', components: 'manual', transfers: 'manual' },
                    'Started a blank call. Add the register and what is being called for.',
                  );
                  setStep('setup');
                }}
                onTemplate={(template) =>
                  replaceModel(
                    { ...template, setup: { ...template.setup, Call_Number: model.setup.Call_Number } },
                    {
                      setup: 'template',
                      lps: 'template',
                      components: 'template',
                      fee: 'template',
                      transfers: 'template',
                    },
                    'Loaded the illustrative fund. Its figures tie to the template workbook exactly.',
                  )
                }
              />
            )}

            {step === 'setup' && (
              <Card title="Fund setup" subtitle="applies to this call only">
                <TermsNote readOnly={readOnly} terms={termsForCall} on={termsDate} settingsHref={`/funds/${fundId}/settings`} />
                <FieldTable
                  fields={SETUP_FIELDS}
                  values={model.setup}
                  readOnly={readOnly}
                  locked={lockedFor('setup')}
                  settingsHref={`/funds/${fundId}/settings`}
                  investors={plugOptions}
                  onChange={(key, value) =>
                    edit(
                      {
                        setup: {
                          ...model.setup,
                          [key]: key.endsWith('_Date') ? serialToISO(value) : value,
                        },
                      },
                      'setup',
                    )
                  }
                />
              </Card>
            )}

            {step === 'lps' && (
              <Card title="LP register" subtitle="opening balances as at this call">
                <EditableTable<LPRow>
                  columns={LP_COLUMNS}
                  rows={model.lps}
                  readOnly={readOnly}
                  addLabel="+ Add investor"
                  newRow={() => ({ LP_ID: '', LP_Name: '', LP_Type: 'LP', Status: 'Active' }) as LPRow}
                  onChange={(lps) => edit({ lps }, 'lps')}
                />
              </Card>
            )}

            <datalist id="dl-component-names">
              {componentNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            {step === 'components' && (
              <Card
                title="Call components"
                subtitle={`${model.setup.Reporting_Currency} ${fmt(componentTotal)} before the management fee`}
              >
                <EditableTable<ComponentRow>
                  columns={COMPONENT_COLUMNS}
                  rows={model.components}
                  readOnly={readOnly}
                  addLabel="+ Add component"
                  newRow={() =>
                    ({
                      Component_ID: nextSeq('C', model.components.map((c) => c.Component_ID)),
                      Component_Name: '',
                      Allocation_Basis: 'Commitment',
                      Reduces_Unfunded: 'Y',
                    }) as ComponentRow
                  }
                  onChange={(components) => edit({ components }, 'components')}
                />
              </Card>
            )}
            {step === 'components' && model.equalizationSchedule?.length ? (
              <div style={{ marginTop: 16 }}>
                <EqualizationCapital schedule={model.equalizationSchedule ?? []} names={lpNames} currency={String(model.setup.Reporting_Currency ?? '')} />
              </div>
            ) : null}

            {step === 'fee' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <Card title="Management fee">
                  <TermsNote readOnly={readOnly} terms={termsForCall} on={termsDate} settingsHref={`/funds/${fundId}/settings`} />
                  <FieldTable
                    fields={FEE_FIELDS}
                    values={model.fee as unknown as Record<string, unknown>}
                    readOnly={readOnly}
                    locked={lockedFor('fee')}
                    settingsHref={`/funds/${fundId}/settings`}
                    onChange={(key, value) => edit({ fee: { ...model.fee, [key]: value } }, 'fee')}
                  />
                </Card>

                {byPeriod ? (
                  <Card title="Fee periods on this call" subtitle="what each still owes, from the fund’s record">
                    <table className="table">
                      <thead>
                        <tr>
                          <th />
                          <th>Period</th>
                          <th>Already billed</th>
                          <th style={{ textAlign: 'right' }}>Still owed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {owed.map((o) => {
                          const k = `${o.period.from}|${o.period.to}`;
                          const on = chosen.has(k);
                          return (
                            <tr key={k}>
                              <td style={{ width: 32 }}>
                                <input
                                  type="checkbox"
                                  aria-label={`Bill ${o.period.label}`}
                                  checked={on}
                                  disabled={readOnly || (!on && o.owedTotal === 0)}
                                  onChange={(e) => toggleFeePeriod(o, e.target.checked)}
                                />
                              </td>
                              <td>
                                <strong>{o.period.label}</strong>{' '}
                                <span className="text-muted">
                                  {fmtDate(o.period.from)} – {fmtDate(o.period.to)}
                                </span>
                              </td>
                              <td className="text-muted">
                                {o.billedOn.length ? o.billedOn.map((b) => `Call No. ${b.callNo} (${fmt(b.amount)})`).join(', ') : '—'}
                              </td>
                              <td className="num">
                                {o.owedTotal ? fmt(o.owedTotal) : '—'}
                                {o.creditTotal > 0 && (
                                  <div className="text-muted" style={{ fontSize: 11 }}>
                                    {fmt(o.creditTotal)} credit due
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {owed.length === 0 && (
                          <tr>
                            <td colSpan={4} className="text-muted">
                              Fees start at the first close. Set the notice date to see the periods.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0, textWrap: 'pretty' }}>
                      Tick every period this call bills — several at once when the fee was paid from a credit line. A period
                      billed in full owes nothing more; someone admitted part-way through still owes their share. A credit due
                      is not billed: crediting it back is the next step, done by hand for now.
                    </p>
                  </Card>
                ) : (
                  <Card title="This call’s fee">
                    <div style={{ padding: '12px 16px', display: 'grid', gap: 6, fontSize: 13 }}>
                      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                        <input type="checkbox" checked={chargesFee} disabled={readOnly} onChange={(e) => setChargesFee(e.target.checked)} />
                        Charge the management fee on this call
                      </label>
                      <span className="text-muted">
                        {!feePeriod
                          ? 'Set the notice date to see which fee period this covers.'
                          : chargesFee
                            ? `Covers ${feePeriod.label} (${fmtDate(feePeriod.from)} – ${fmtDate(feePeriod.to)}). Charge it on one call per period.`
                            : `Left out: ${feePeriod.label}'s fee is charged on another call. Its offsets are left out with it.`}
                      </span>
                    </div>
                  </Card>
                )}

                <FeePreview
                  result={result}
                  basis={String(model.fee.Fee_Basis || model.setup.Default_Mgmt_Fee_Basis || 'Commitment')}
                  currency={String(model.setup.Reporting_Currency ?? '')}
                  onUseRegister={readOnly ? undefined : useFundRegisterOnly}
                />

                <EqualizationCatchUp schedule={model.equalizationSchedule ?? []} names={lpNames} currency={String(model.setup.Reporting_Currency ?? '')} />

                <Card title="Offsets" subtitle="reduce the gross fee">
                  <EditableTable<OffsetRow>
                    columns={OFFSET_COLUMNS}
                    rows={model.fee.offsets ?? []}
                    readOnly={readOnly}
                    addLabel="+ Add offset"
                    newRow={() =>
                      ({
                        Offset_ID: nextSeq('O', (model.fee.offsets ?? []).map((o) => o.Offset_ID)),
                        Description: '',
                        Amount: '',
                        Allocation_Method: 'Pro-rata to gross fee',
                      }) as OffsetRow
                    }
                    onChange={(offsets) => edit({ fee: { ...model.fee, offsets } }, 'fee')}
                  />
                  <p className="text-muted" style={{ padding: '0 16px 14px', fontSize: 12 }}>
                    Offsets are allocated over fee payers only and netted against the gross fee.
                  </p>
                </Card>
              </div>
            )}

            {step === 'transfers' && (
              <Card title="Transfers" subtitle="applied when effective on or before the call date">
                <EditableTable<TransferRow>
                  columns={TRANSFER_COLUMNS}
                  rows={model.transfers}
                  readOnly={readOnly}
                  addLabel="+ Add transfer"
                  newRow={() =>
                    ({ Transfer_ID: nextSeq('T', model.transfers.map((t) => t.Transfer_ID)), Transfer_Type: 'Partial', Transfer_Pct: '' }) as TransferRow
                  }
                  onChange={(transfers) => edit({ transfers }, 'transfers')}
                  leadingHeader="Applied"
                  leading={(t) => {
                    const effective = serialToISO(t.Effective_Date);
                    const callDate = serialToISO(model.setup.Call_Date);
                    const applies = !effective || !callDate || effective <= callDate;
                    return (
                      <Tag tone={applies ? 'accent' : 'neutral'}>
                        {applies ? 'Applied' : 'Not applied'}
                      </Tag>
                    );
                  }}
                />
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function SaveIndicator({ state, unsaved, readOnly }: { state: SaveState; unsaved: boolean; readOnly: boolean }) {
  if (readOnly) return null;
  const text =
    state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : unsaved ? 'Unsaved changes' : state === 'saved' ? 'Saved' : '';
  if (!text) return null;
  return (
    <span
      className="text-muted"
      style={{ fontSize: 12, color: state === 'error' || unsaved ? 'var(--destructive)' : undefined }}
      aria-live="polite"
    >
      {text}
    </span>
  );
}

/** The next free ID in a series — C1, C2… — after the highest one in use. */
export function nextSeq(prefix: string, taken: unknown[]): string {
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const n = taken.map((id) => re.exec(String(id ?? '').trim())?.[1]).filter(Boolean).map(Number);
  return `${prefix}${(n.length ? Math.max(...n) : 0) + 1}`;
}

const dismissStyle = {
  border: 0,
  background: 'transparent',
  font: 'inherit',
  fontSize: 12,
  color: 'var(--foreground)',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
} as const;

export { STEPS };

/** One line above a step's fields, saying where the fund-level ones come from. */
function TermsNote({
  readOnly,
  terms,
  on,
  settingsHref,
}: {
  readOnly: boolean;
  terms: FundTerms | null;
  on: string;
  settingsHref: string;
}) {
  if (readOnly) return null;
  return (
    <p className="text-muted" style={{ fontSize: 12, margin: '10px 16px 4px', textWrap: 'pretty' }}>
      {terms ? (
        <>
          Fields marked <em>From fund terms</em> follow the fund&rsquo;s terms in force on {fmtDate(on)}.{' '}
          <Link href={settingsHref}>Change them in Fund terms</Link>.
        </>
      ) : (
        <>
          This fund has no terms recorded, so these are typed per call.{' '}
          <Link href={settingsHref}>Record them in Fund terms</Link> and every call starts from them.
        </>
      )}
    </p>
  );
}

/**
 * The management fee on this call, investor by investor: what it is charged
 * on, the rate — the fund's, a side letter's, or none for the exempt — the
 * share of a year, and what that comes to after offsets.
 */
type EqSchedule = NonNullable<CallModel['equalizationSchedule']>;

/** Who is on a closing's equalization for a part, and their amount (+ pays, − credited). */
const partRows = (e: EqSchedule[number], keys: ('capital' | 'interest' | 'catchUpFee')[]) =>
  Object.entries(e.parts).filter(([, p]) => keys.some((k) => p[k] !== 0));

/**
 * A later closing's equalization for the capital called before an investor
 * joined: their share of earlier calls, and interest for paying it late. Shown
 * with the call's components, which it is the same kind of money as.
 */
function EqualizationCapital({ schedule, names, currency }: { schedule: EqSchedule; names: Map<string, string>; currency: string }) {
  return (
    <Card title="Equalization: earlier calls" subtitle={`${currency} · from ${schedule.map((e) => `Closing ${e.closingNo}`).join(', ')}`}>
      {schedule.map((e) => {
        const rows = partRows(e, ['capital', 'interest']);
        return rows.length === 0 ? (
          <p key={e.closingId} className="text-muted" style={{ fontSize: 13, padding: '12px 16px', margin: 0, textWrap: 'pretty' }}>
            Closing {e.closingNo} moves no capital: no call before it called any components. Its catch-up fee is on the
            Management fee step.
          </p>
        ) : (
          <div key={e.closingId} style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Closing {e.closingNo}</th>
                  <th style={{ textAlign: 'right' }}>Share of earlier calls</th>
                  <th style={{ textAlign: 'right' }}>Late interest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, p]) => (
                  <tr key={id}>
                    <td>
                      <span className="mono">{id}</span> {names.get(id) ?? ''}
                    </td>
                    <td className="num">{p.capital ? fmt(p.capital) : '—'}</td>
                    <td className="num">{p.interest ? fmt(p.interest) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0, textWrap: 'pretty' }}>
        Worked out from the closing, not typed: a late investor pays (+), an earlier one is credited (brackets). It is
        cash on top of what this call draws — balances moved on the closing date.
      </p>
    </Card>
  );
}

/**
 * A later closing's catch-up fee: the management fee a late investor pays for
 * the time before they joined, and who it goes to. Shown with the fee, which it
 * is, though it is not part of any fee period.
 */
function EqualizationCatchUp({ schedule, names, currency }: { schedule: EqSchedule; names: Map<string, string>; currency: string }) {
  const withFee = schedule.filter((e) => partRows(e, ['catchUpFee']).length);
  if (!withFee.length) return null;
  return (
    <Card title="Catch-up fee from later closings" subtitle={`${currency} · the fee for the time before they joined`}>
      {withFee.map((e) => {
        const rows = partRows(e, ['catchUpFee']);
        // Paid among investors it adds up to nothing; paid to the manager, to the manager's share.
        const toManager = rows.reduce((t, [, p]) => t + p.catchUpFee, 0);
        return (
          <div key={e.closingId} style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Closing {e.closingNo}</th>
                  <th style={{ textAlign: 'right' }}>Catch-up fee</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, p]) => (
                  <tr key={id}>
                    <td>
                      <span className="mono">{id}</span> {names.get(id) ?? ''}
                    </td>
                    <td className="num">{p.catchUpFee > 0 ? `pays ${fmt(p.catchUpFee)}` : `receives ${fmt(-p.catchUpFee)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0, textWrap: 'pretty' }}>
              {Math.abs(toManager) < 0.005
                ? 'Goes to the investors already in, not the manager: it is not fee income, and is not in the fee periods above.'
                : `${fmt(toManager)} goes to the manager: fee income on top of the fee periods above, not part of them.`}
            </p>
          </div>
        );
      })}
    </Card>
  );
}

function FeePreview({
  result,
  basis,
  currency,
  onUseRegister,
}: {
  result: ComputeResult;
  basis: string;
  currency: string;
  /** Put the fund's register on the call; absent when the call is read-only. */
  onUseRegister?: () => void;
}) {
  const rows = result.rows.filter((r) => r.isActive);
  const schedule = result.fee.schedule;
  const missing = result.fee.notOnRegister ?? [];
  if (schedule) {
    // Billed period by period: a column for each, as the record worked it out.
    return (
      <Card title="What each investor is charged" subtitle={`${currency} · ${schedule.length ? scheduleLabel(schedule) : 'no fee on this call'}`}>
        {missing.length > 0 && (
          <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            <Tag tone="danger">Not on this call</Tag>
            <span style={{ flex: 1, minWidth: 0, textWrap: 'pretty' }}>
              {rows.length === 0
                ? 'This call has no investors on its register yet, so it bills nobody. '
                : `${missing.join(', ')} ${missing.length === 1 ? 'owes' : 'owe'} a fee for these periods but ${missing.length === 1 ? 'is' : 'are'} not on this call's register, so ${missing.length === 1 ? 'is' : 'are'} billed nothing. `}
              The register comes from the fund&rsquo;s closings.
            </span>
            {onUseRegister && (
              <Button small variant="primary" onClick={onUseRegister}>
                Use the fund&rsquo;s register
              </Button>
            )}
          </div>
        )}
        {schedule.length === 0 ? (
          <p className="text-muted" style={{ padding: '14px 16px', margin: 0 }}>
            No fee period is ticked, so this call bills no management fee.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Investor</th>
                  {schedule.map((e) => (
                    <th key={e.from} style={{ textAlign: 'right' }}>
                      {e.label}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }}>Fee</th>
                  <th style={{ textAlign: 'right' }}>Offset</th>
                  <th style={{ textAlign: 'right' }}>Called</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.LP_ID}>
                    <td>
                      <span className="mono">{r.LP_ID}</span> {String(r.LP_Name ?? '')}
                    </td>
                    {schedule.map((e, i) => (
                      <td key={e.from} className="num">
                        {r.feeByPeriod?.[i] ? fmt(r.feeByPeriod[i]) : '—'}
                      </td>
                    ))}
                    <td className="num">{fmt(r.feeGross)}</td>
                    <td className="num">{r.feeOffset ? `(${fmt(r.feeOffset)})` : '—'}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {fmt(r.feeNet)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  {schedule.map((e) => (
                    <td key={e.from} className="num">
                      {fmt(e.total)}
                    </td>
                  ))}
                  <td className="num">{fmt(result.totals.feeGross)}</td>
                  <td className="num">{result.totals.feeOffset ? `(${fmt(result.totals.feeOffset)})` : '—'}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmt(result.totals.feeNet)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-muted" style={{ fontSize: 12, padding: '8px 16px', margin: 0 }}>
              Each period is worked out from the fund&rsquo;s record — commitment, side-letter rate and joining date. The
              working for a period is on Management fees.
            </p>
          </div>
        )}
      </Card>
    );
  }
  const period = result.fee.period;
  const onInvested = result.fee.basis === 'Invested_Capital';
  const basisOf = (r: ComputeResult['rows'][number]) => num(onInvested ? r.Opening_Invested_Capital : r.Commitment);
  return (
    <Card title="What each investor is charged" subtitle={`${currency} · on ${onInvested ? 'invested capital' : 'commitment'}${basis !== result.fee.basis ? ` (asked for ${basis})` : ''}`}>
      {rows.length === 0 ? (
        <p className="text-muted" style={{ padding: '14px 16px', margin: 0 }}>
          Add the register first.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Investor</th>
                <th style={{ textAlign: 'right' }}>{onInvested ? 'Invested capital' : 'Commitment'}</th>
                <th>× rate × share of year</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th style={{ textAlign: 'right' }}>Offset</th>
                <th style={{ textAlign: 'right' }}>Called</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.LP_ID}>
                  <td>
                    <span className="mono">{r.LP_ID}</span> {String(r.LP_Name ?? '')}
                  </td>
                  <td className="num">{fmt(basisOf(r))}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.feeRate === 0 ? 'exempt' : `× ${pct(r.feeRate)} × ${period}`}
                  </td>
                  <td className="num">{fmt(r.feeGross)}</td>
                  <td className="num">{r.feeOffset ? `(${fmt(r.feeOffset)})` : '—'}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmt(r.feeNet)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 600 }} colSpan={3}>
                  Total
                </td>
                <td className="num">{fmt(result.totals.feeGross)}</td>
                <td className="num">{result.totals.feeOffset ? `(${fmt(result.totals.feeOffset)})` : '—'}</td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {fmt(result.totals.feeNet)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
