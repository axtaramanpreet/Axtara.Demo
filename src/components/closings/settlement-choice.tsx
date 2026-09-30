'use client';

import { useState } from 'react';
import type { Settlement } from '@/engine';

/** A way to settle that is not open to this closing, and why. */
export type SettlementBlocked = Partial<Record<Settlement, string>>;
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';

const SETTLEMENT_OPTIONS: { value: Settlement; label: string; detail: string }[] = [
  {
    value: 'on_closing',
    label: 'Settle now',
    detail:
      'Each investor gets a statement, payable by a date you pick when approving: a late investor pays what they owe, an earlier one is told what comes back. Balances move on the closing date.',
  },
  {
    value: 'next_call',
    label: 'On the next capital call',
    detail:
      'Added to a late investor’s next call and taken off an earlier investor’s. No extra document. Balances move on that call: until then, a late investor has paid nothing and all their commitment is unfunded.',
  },
];

/** The two ways to settle, as radio options. */
export function SettlementOptions({
  value,
  onChange,
  disabled,
  blocked = {},
  name,
}: {
  value: Settlement | null;
  onChange: (s: Settlement) => void;
  disabled?: boolean;
  /** Ways not open to this closing, each with the reason, shown under it. */
  blocked?: SettlementBlocked;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label="How the equalization is settled" style={{ display: 'grid', gap: 8 }}>
      {SETTLEMENT_OPTIONS.map((o) => (
        <label
          key={o.value}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '10px 12px',
            border: `1px solid ${value === o.value ? 'var(--foreground)' : 'var(--border)'}`,
            borderRadius: 8,
            cursor: disabled || blocked[o.value] ? 'default' : 'pointer',
          }}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled || Boolean(blocked[o.value])}
            onChange={() => onChange(o.value)}
            style={{ marginTop: 3 }}
          />
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 13 }}>{o.label}</strong>
            <span className="text-muted" style={{ fontSize: 12, textWrap: 'pretty' }}>
              {o.detail}
            </span>
            {blocked[o.value] && (
              <span style={{ display: 'block', fontSize: 12, marginTop: 4, color: 'var(--foreground)', textWrap: 'pretty' }}>
                Not open to this closing: {blocked[o.value]}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * How a finalised closing's equalization is settled, and changing it.
 *
 * The figures are fixed; this only says which document asks for the cash. It
 * stays open to change until a sent call has settled part of it. Saved only
 * when someone presses Save.
 */
export function SettlementCard({
  fundId,
  closingId,
  closingNo,
  settlement,
  settledOn,
  statementsSent,
  blocked,
  canWrite,
  onChanged,
}: {
  fundId: string;
  closingId: string;
  closingNo: number;
  settlement: Settlement | null;
  /** Sent calls that settled part of it; once there is one, the choice is fixed. */
  settledOn: number[];
  /** Statements already sent for it; once there is one, the choice is fixed too. */
  statementsSent: number;
  /** Ways not open to it, because of the closings around it. */
  blocked?: SettlementBlocked;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [choice, setChoice] = useState<Settlement | null>(settlement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = settledOn.length > 0 || statementsSent > 0;
  const changed = choice !== settlement;

  async function save() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/funds/${fundId}/closings/${closingId}/settlement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlement: choice }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save how it is settled.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save how it is settled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="How the equalization is settled"
      subtitle={
        settledOn.length
          ? `settled on Call No. ${settledOn.join(', ')}: fixed`
          : statementsSent
            ? `${statementsSent} statement${statementsSent === 1 ? '' : 's'} sent: fixed`
            : 'which document asks for the money'
      }
    >
      <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
        {!settlement && (
          <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <Tag tone="danger">Not chosen</Tag>
            <span style={{ textWrap: 'pretty' }}>
              Closing {closingNo} moves money between investors, and nothing asks for it yet. Calls after it cannot be
              approved until this is chosen.
            </span>
          </div>
        )}
        <SettlementOptions
          name={`settlement-${closingId}`}
          value={choice}
          onChange={setChoice}
          disabled={!canWrite || locked || busy}
          blocked={blocked}
        />
        <p className="text-muted" style={{ fontSize: 12, margin: 0, textWrap: 'pretty' }}>
          The amounts are fixed. This decides which document asks for the money and when paid-in and unfunded move: on
          the closing date when settled now, on the call when settled on the next call.
        </p>
        {error && (
          <p role="alert" style={{ color: 'var(--destructive)', margin: 0, fontSize: 13 }}>
            {error}
          </p>
        )}
        {canWrite && !locked && (
          <div>
            <Button variant="primary" small onClick={save} loading={busy} disabled={!changed || !choice}>
              Save
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
