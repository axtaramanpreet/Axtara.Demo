'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { compute } from '@/engine';
import type { CallDetail } from '@/adapters/storage/types';
import { fmtDate, serialToISO } from '@/engine';
import { Button } from '@/components/ui/button';
import { StageTag } from '@/components/ui/tag';
import { AllocationTab } from './allocation-tab';
import { ChecksTab } from './checks-tab';
import { NoticesTab } from './notices-tab';
import { SummaryTab } from './summary-tab';

const TABS = ['summary', 'allocation', 'checks', 'notices'] as const;
type Tab = (typeof TABS)[number];

/**
 * One capital call, across its four views.
 *
 * The call is recomputed here from stored inputs rather than read from a
 * snapshot: for a call still being prepared there is no snapshot by design, and
 * for an issued one the inputs are frozen, so the two agree. The snapshot is
 * the audit record of what was sent, not the source for what is displayed.
 *
 * The tab and selected investor live in the URL so a colleague can be sent
 * straight to the check that is failing.
 */
export function CallScreen({
  call,
  clientId,
  email,
}: {
  call: CallDetail;
  clientId: string;
  /** Whether notices can be emailed, and whether they are being redirected. */
  email: { configured: boolean; overrideTo: string | null };
}) {
  const router = useRouter();
  const params = useSearchParams();

  const basePath = `/clients/${clientId}/calls/${call.id}`;
  const tabParam = params.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'summary';
  const selectedLp = params.get('lp') ?? undefined;

  const result = compute(call.model);
  const failing = result.checks.filter((c) => c.level === 'fail').length;
  const warnings = result.checks.filter((c) => c.level === 'warn').length;
  const active = result.rows.filter((r) => r.isActive);
  const sent = call.notices.filter((n) => n.status === 'sent').length;

  function go(next: Tab, lpId?: string) {
    const query = new URLSearchParams({ tab: next });
    if (lpId) query.set('lp', lpId);
    router.replace(`${basePath}?${query}`, { scroll: false });
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <Link href={`/clients/${clientId}`} className="crumb" data-noprint="1">
        ‹ All calls
      </Link>

      <div
        data-noprint="1"
        style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginTop: 10 }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1>Capital Call No. {String(call.callNo)}</h1>
            <StageTag stage={call.stage} />
          </div>
          <p className="text-muted">
            Notice date {fmtDate(serialToISO(call.model.setup.Call_Date))} · payment due{' '}
            {fmtDate(serialToISO(call.model.setup.Payment_Due_Date))} · {active.length} investors
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <Link href={`${basePath}/setup`} className="btn btn-secondary">
            Edit inputs
          </Link>
          <Button variant="secondary" onClick={() => go('allocation')}>
            Export .xlsx
          </Button>
        </div>
      </div>

      <nav className="tabs" data-noprint="1" style={{ marginTop: 22 }}>
        <TabLink current={tab} id="summary" onGo={go}>
          Summary
        </TabLink>
        <TabLink current={tab} id="allocation" onGo={go}>
          Allocation
        </TabLink>
        <TabLink current={tab} id="checks" onGo={go}>
          Checks
          {failing > 0
            ? ` (${failing} failing)`
            : warnings > 0
              ? ` (${warnings} warnings)`
              : ''}
        </TabLink>
        <TabLink current={tab} id="notices" onGo={go}>
          Notices ({sent}/{active.length} sent)
        </TabLink>
      </nav>

      {tab === 'summary' && <SummaryTab call={call} result={result} basePath={basePath} />}
      {tab === 'allocation' && <AllocationTab call={call} result={result} />}
      {tab === 'checks' && <ChecksTab result={result} goldenSource={call.model.goldenSource} />}
      {tab === 'notices' && (
        <NoticesTab
          call={call}
          result={result}
          email={email}
          selectedLp={selectedLp}
          onSelect={(lpId) => go('notices', lpId)}
        />
      )}
    </div>
  );
}

function TabLink({
  current,
  id,
  onGo,
  children,
}: {
  current: Tab;
  id: Tab;
  onGo: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`?tab=${id}`}
      className={current === id ? 'on' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onGo(id);
      }}
    >
      {children}
    </a>
  );
}
