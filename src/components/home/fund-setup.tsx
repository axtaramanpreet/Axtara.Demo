import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CallSummary, Closing } from '@/adapters/storage/types';
import { fmt, fmtDate, type CallDefaults, type FundTerms } from '@/engine';
import { Card } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { NewCallButton } from '@/app/funds/[fundId]/new-call-button';
import { Button } from '@/components/ui/button';
import type { FundGates } from '@/lib/fund-gates';

export type StepState = 'done' | 'started' | 'todo';

export interface SetupSteps {
  terms: { state: StepState; from: string | null };
  investors: { state: StepState; count: number; incomplete: number };
  firstClose: { state: StepState; investors: number; committed: number; date: string | null };
  /** Done once a call is locked: its first notice has gone out. */
  firstCall: { state: StepState; openCall: CallSummary | null };
  /** The first step not yet done, or null when all are. */
  current: 'terms' | 'investors' | 'firstClose' | 'firstCall' | null;
}

/**
 * Where a new fund is in being set up.
 *
 * The order is the order the work arrives in: the LPA's terms, the investors
 * as they are onboarded, who committed at the first close, then the first call
 * — whose register is then read from that close rather than typed.
 */
export function setupSteps(
  terms: FundTerms[],
  investors: { count: number; incomplete: number },
  closings: Closing[],
  calls: CallSummary[],
): SetupSteps {
  const first = [...closings].sort((a, b) => a.closingDate.localeCompare(b.closingDate) || a.closingNo - b.closingNo)[0];
  const earliest = [...terms].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  const openCall = [...calls].sort((a, b) => a.callNo - b.callNo).find((c) => !c.lockedAt) ?? null;

  const steps = {
    terms: { state: (terms.length ? 'done' : 'todo') as StepState, from: earliest?.effectiveFrom ?? null },
    // Done once anyone is on the register: a closing can add the rest.
    investors: { state: (investors.count ? 'done' : 'todo') as StepState, ...investors },
    firstClose: {
      state: (!first ? 'todo' : first.finalised ? 'done' : 'started') as StepState,
      investors: first?.commitments.length ?? 0,
      committed: first?.commitments.reduce((s, k) => s + k.amount, 0) ?? 0,
      date: first?.closingDate ?? null,
    },
    firstCall: {
      state: (calls.some((c) => c.lockedAt) ? 'done' : calls.length ? 'started' : 'todo') as StepState,
      openCall,
    },
  };
  const current = (['terms', 'investors', 'firstClose', 'firstCall'] as const).find((k) => steps[k].state !== 'done') ?? null;
  return { ...steps, current };
}

/**
 * The checklist a new fund's home opens on, until its first call is issued.
 *
 * A step opens only once the one before it is done (`fundGates`): a closing
 * reads the terms, and a call's register reads the first close.
 */
export function FundSetup({
  fundId,
  fundName,
  steps,
  defaults,
  termsToday,
  gates,
}: {
  fundId: string;
  fundName: string;
  steps: SetupSteps;
  defaults: CallDefaults;
  termsToday: FundTerms | null;
  gates: FundGates;
}) {
  const done = (['terms', 'investors', 'firstClose', 'firstCall'] as const).filter((k) => steps[k].state === 'done').length;
  const { terms, investors, firstClose, firstCall, current } = steps;

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 24, maxWidth: 760 }}>
      <Card title={`Set up ${fundName}`} subtitle={`${done} of 4 done`}>
        <ol className="setup-steps">
          <Step
            n={1}
            state={terms.state}
            current={current === 'terms'}
            title="Record the fund’s terms"
            what="From the LPA: the management fee and what it is charged on, the investment period, late-close interest, and where investors wire money. Every call and closing reads them. Or download the template, fill it in, and import it."
            done={terms.from ? `Recorded, in force from ${fmtDate(terms.from)}.` : 'Recorded.'}
            action={
              <Link className={`btn ${current === 'terms' ? 'btn-primary' : 'btn-secondary'}`} href={`/funds/${fundId}/settings`}>
                {terms.state === 'done' ? 'Review the terms' : 'Record the terms'}
              </Link>
            }
          />
          <Step
            n={2}
            state={investors.state}
            current={current === 'investors'}
            title="Add the investors"
            what="Each investor as they are onboarded: who they are, where their notices go and who gets a copy, their country and KYC. Anyone a closing names who is not here yet is added for you."
            done={`${investors.count} on the register${investors.incomplete ? `, ${investors.incomplete} with a profile to finish` : ''}.`}
            action={
              <Link className={`btn ${current === 'investors' ? 'btn-primary' : 'btn-secondary'}`} href={`/funds/${fundId}/investors`}>
                {investors.state === 'done' ? 'See investors' : 'Add investors'}
              </Link>
            }
          />
          <Step
            n={3}
            state={firstClose.state}
            current={current === 'firstClose'}
            title="Record the first close"
            what="Who committed, and how much, with any side-letter fee rate. Management fees run from this date, and later closes are equalized against it. A long list can be imported from a template."
            done={`Finalised${firstClose.date ? ` on ${fmtDate(firstClose.date)}` : ''}: ${firstClose.investors} investors, ${fmt(firstClose.committed)} committed.`}
            started={`Drafted: ${firstClose.investors} investors so far. Finalise it when the list is complete.`}
            locked={gates.closings}
            action={
              gates.closings ? (
                <Button disabled>Record the first close</Button>
              ) : (
                <Link className={`btn ${current === 'firstClose' ? 'btn-primary' : 'btn-secondary'}`} href={`/funds/${fundId}/closings`}>
                  {firstClose.state === 'done' ? 'See closings' : firstClose.state === 'started' ? 'Finish the first close' : 'Record the first close'}
                </Link>
              )
            }
          />
          <Step
            n={4}
            state={firstCall.state}
            current={current === 'firstCall'}
            title="Issue the first capital call"
            what="Start it from the fund’s investors: the register fills in from the first close. Add what is being called for, check it ties, and send the notices."
            done="Issued."
            started={firstCall.openCall ? `Call No. ${firstCall.openCall.callNo} is in progress.` : 'In progress.'}
            locked={gates.calls}
            action={
              gates.calls ? (
                <Button disabled>Start the first call</Button>
              ) : firstCall.openCall ? (
                <Link
                  className={`btn ${current === 'firstCall' ? 'btn-primary' : 'btn-secondary'}`}
                  href={`/funds/${fundId}/calls/${firstCall.openCall.id}/setup`}
                >
                  Continue Call No. {firstCall.openCall.callNo}
                </Link>
              ) : (
                <NewCallButton
                  fundId={fundId}
                  fundName={fundName}
                  defaults={defaults}
                  terms={termsToday}
                  label="Start the first call"
                  variant={current === 'firstCall' ? 'primary' : 'secondary'}
                  align="start"
                />
              )
            }
          />
        </ol>
      </Card>

    </div>
  );
}

function Step({
  n,
  state,
  current,
  title,
  what,
  done,
  started,
  locked,
  action,
}: {
  n: number;
  state: StepState;
  current: boolean;
  title: string;
  what: string;
  done: string;
  started?: string;
  /** Why this step is not open yet, or null. */
  locked?: string | null;
  action: ReactNode;
}) {
  return (
    <li
      className={['setup-step', state, current ? 'current' : '', locked ? 'locked' : ''].filter(Boolean).join(' ')}
      aria-current={current ? 'step' : undefined}
    >
      <span className="setup-num" aria-hidden>
        {state === 'done' ? '✓' : n}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{title}</strong>
          {state === 'done' && <Tag tone="accent">Done</Tag>}
          {state === 'started' && <Tag tone="warn">In progress</Tag>}
        </div>
        <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13, textWrap: 'pretty' }}>
          {state === 'done' ? done : state === 'started' && started ? started : what}
        </p>
        {locked && state !== 'done' && (
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>{locked}</p>
        )}
      </div>
      <div className="setup-action">{action}</div>
    </li>
  );
}
