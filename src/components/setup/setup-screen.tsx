'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { CallDetail, CallSources } from '@/adapters/storage/types';
// Type-only, so this does not pull SheetJS into the bundle; the module itself
// is imported on demand when a workbook is actually opened.
import type { WorkbookLike, WorkbookReader } from '@/adapters/workbook/parse-workbook';
import { applyFundTerms, fmt, fmtDate, num, serialToISO, termsOn, type FundTerms } from '@/engine';
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

/** How long to wait after the last keystroke before saving. */
const SAVE_DEBOUNCE_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SetupScreen({
  call,
  fundId,
  previousCall,
  fundTerms,
  today,
}: {
  call: CallDetail;
  fundId: string;
  /** The call before this one, for carrying the register forward. */
  previousCall?: CallDetail | null;
  /** The fund's terms, every row. The ones in force on the call date apply. */
  fundTerms: FundTerms[];
  /** YYYY-MM-DD, from the server: the date terms are read on before the call has one. */
  today: string;
}) {
  const router = useRouter();
  const repo = useMemo(() => createSupabaseRepository(createBrowserSupabase()), []);

  const readOnlyAtLoad = call.lockedAt !== null;
  const [initial] = useState(() => withTerms(call.model, fundTerms, today, readOnlyAtLoad));
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

  // Skip the save that would otherwise fire from the first render — unless the
  // fund's terms changed the call as it loaded, which is worth keeping.
  const dirty = useRef(initial.message !== null);

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

  const save = useCallback(
    async (nextModel: CallModel, nextSources: Partial<CallSources>) => {
      setSaveState('saving');
      setError(null);
      try {
        await repo.saveCall(call.id, nextModel, nextSources);
        setSaveState('saved');
      } catch (e) {
        setSaveState('error');
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    },
    [repo, call.id],
  );

  // Autosave. The accountant is editing a spreadsheet, not filling in a form
  // with a Save button, so work is persisted as they go — debounced, because
  // one write per keystroke would be both slow and pointless.
  useEffect(() => {
    if (!dirty.current || readOnly) return;
    const timer = setTimeout(() => void save(model, sources), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [model, sources, save, readOnly]);

  /**
   * Record an edit.
   *
   * Editing a step marks it Manual: whatever it said before, these figures were
   * typed by a person, and the stepper should say so rather than still claiming
   * they came from a workbook.
   */
  function edit(next: Partial<CallModel>, touched?: keyof CallSources) {
    dirty.current = true;
    const applied = withTerms({ ...model, ...next }, fundTerms, today, readOnly);
    setModel(applied.model);
    if (applied.message) setStatus(applied.message);
    if (touched) setSources((s) => ({ ...s, [touched]: 'manual' }));
  }

  function replaceModel(next: CallModel, nextSources: CallSources, message: string) {
    dirty.current = true;
    // A workbook, the template or the previous call carries its own fund-level
    // figures; where Settings has a term, Settings wins, and the message says
    // what it replaced so nobody is surprised by a fee they did not upload.
    const applied = withTerms(next, fundTerms, today, readOnly);
    setModel(applied.model);
    setSources(nextSources);
    setStatus(applied.message ? `${message} ${applied.message}` : message);
    void save(applied.model, nextSources);
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
            `Read ${file.name} — ${parsed.lps.length} investors and ${parsed.components.length} components. Check the figures below before allocating.`,
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

  async function onReviewAllocation() {
    if (dirty.current) await save(model, sources);
    setOverlay({
      ...REVIEW_STEPS(model.setup.Call_Number ?? ''),
      then: () => router.push(`/funds/${fundId}/calls/${call.id}`),
    });
  }

  async function onDelete() {
    if (!window.confirm(`Delete Capital Call No. ${model.setup.Call_Number}? This cannot be undone.`))
      return;
    try {
      await repo.deleteCall(call.id);
      router.push(`/funds/${fundId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this call.');
    }
  }

  const componentTotal = model.components.reduce((s, c) => s + num(c.Total_Amount), 0);
  const offsetTotal = (model.fee.offsets ?? []).reduce((s, o) => s + num(o.Amount), 0);

  return (
    <>
      <Datalists />

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
                : 'Nothing to call yet — add components, or start from a workbook.'}
            </p>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <SaveIndicator state={saveState} readOnly={readOnly} />
            {!readOnly && (
              <Button variant="ghost" onClick={onDelete}>
                Delete call
              </Button>
            )}
            <Button variant="primary" onClick={onReviewAllocation}>
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
              lps: model.lps.length ? `${model.lps.length} investors` : undefined,
              components: model.components.length
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
                  investors={model.lps
                    .filter((l) => String(l.LP_ID ?? '').trim())
                    .map((l) => ({ value: String(l.LP_ID), label: String(l.LP_Name ?? l.LP_ID) }))}
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
                      Component_ID: '',
                      Component_Name: '',
                      Allocation_Basis: 'Commitment',
                      Reduces_Unfunded: 'Y',
                    }) as ComponentRow
                  }
                  onChange={(components) => edit({ components }, 'components')}
                />
              </Card>
            )}

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

                <Card title="Offsets" subtitle="reduce the gross fee">
                  <EditableTable<OffsetRow>
                    columns={OFFSET_COLUMNS}
                    rows={model.fee.offsets ?? []}
                    readOnly={readOnly}
                    addLabel="+ Add offset"
                    newRow={() =>
                      ({
                        Offset_ID: '',
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
                    ({ Transfer_ID: '', Transfer_Type: 'Partial', Transfer_Pct: '' }) as TransferRow
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

function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) return null;
  const text =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : '';
  if (!text) return null;
  return (
    <span
      className="text-muted"
      style={{ fontSize: 12, color: state === 'error' ? 'var(--destructive)' : undefined }}
      aria-live="polite"
    >
      {text}
    </span>
  );
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
          Fields marked <em>From Settings</em> follow the fund\u2019s terms in force on {fmtDate(on)}.{' '}
          <Link href={settingsHref}>Change them in Settings</Link>.
        </>
      ) : (
        <>
          This fund has no terms recorded, so these are typed per call.{' '}
          <Link href={settingsHref}>Record them in Settings</Link> and every call starts from them.
        </>
      )}
    </p>
  );
}
