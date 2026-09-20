'use client';

import { Suspense } from 'react';
import type { Client } from '@/adapters/storage/types';
import { AskAxtara, AskTrigger, type Surface } from '@/components/ask/ask-axtara';
import { Sidebar, type Module } from './sidebar';
import { initialsOf, TopBar, type Crumb } from './topbar';

/**
 * The frame every screen inside a fund sits in: sidebar, top bar, and the
 * assistant over the top of both.
 *
 * Mounted by each page rather than by a layout, because the breadcrumb's leaf
 * is a fact only the page knows ("Capital Call No. 2"), and a layout cannot be
 * told it without a context the pages would have to write into anyway. The
 * conversation survives that remount by living outside React.
 */
export function AppShell({
  clients,
  clientId,
  module = 'capital-calls',
  callCount,
  crumb,
  surface,
  callNo,
  preparedBy,
  askConnected,
  children,
}: {
  clients: Client[];
  clientId: string;
  module?: Module;
  callCount: number;
  crumb: Crumb;
  surface: Surface;
  /** The call this page is about, when it is about one. */
  callNo?: number;
  /** From the call's Fund_Setup, for the avatar. */
  preparedBy?: string | null;
  /** Whether a model endpoint is configured. Decided on the server. */
  askConnected: boolean;
  children: React.ReactNode;
}) {
  const fundName = clients.find((c) => c.id === clientId)?.name ?? 'Fund';

  return (
    <div className="app">
      <Sidebar clients={clients} clientId={clientId} module={module} callCount={callCount} />

      <div className="content">
        <TopBar
          fundName={fundName}
          crumb={crumb}
          userInitials={initialsOf(preparedBy)}
          askTrigger={<AskTrigger />}
        />
        <main style={{ padding: '28px 32px 60px', flex: 1 }}>{children}</main>
      </div>

      {/* Reads the tab from the URL to know what a question is about, which is
          a search param, hence the boundary. */}
      <Suspense fallback={null}>
        <AskAxtara
          clientId={clientId}
          fundName={fundName}
          surface={surface}
          callNo={callNo}
          connected={askConnected}
        />
      </Suspense>
    </div>
  );
}
