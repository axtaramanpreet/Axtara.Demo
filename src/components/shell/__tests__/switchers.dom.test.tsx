// @vitest-environment jsdom

/**
 * Who you work for, and what you work on: the client in the sidebar, the fund
 * in the top bar.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));
const createFund = vi.fn(async () => ({ id: 'new', name: 'New', clientId: 'k2', clientName: 'Beta GP' }));
vi.mock('@/adapters/storage/supabase-client', () => ({ createBrowserSupabase: () => ({}) }));
vi.mock('@/adapters/storage/supabase-repository', () => ({ createSupabaseRepository: () => ({ createFund }) }));

import type { Fund } from '@/adapters/storage/types';
import { Sidebar, clientsOf } from '../sidebar';
import { TopBar } from '../topbar';

afterEach(cleanup);

const funds: Fund[] = [
  { id: 'f1', name: 'Alpha Fund I', clientId: 'k1', clientName: 'Alpha GP' },
  { id: 'f2', name: 'Alpha Fund II', clientId: 'k1', clientName: 'Alpha GP' },
  { id: 'f3', name: 'Beta Fund I', clientId: 'k2', clientName: 'Beta GP' },
];

describe('the client, in the sidebar', () => {
  it('groups the funds by client', () => {
    expect(clientsOf(funds).map((c) => [c.name, c.funds.map((f) => f.id)])).toEqual([
      ['Alpha GP', ['f1', 'f2']],
      ['Beta GP', ['f3']],
    ]);
  });

  it('switches to another client, landing on its first fund', async () => {
    render(<Sidebar funds={funds} fundId="f3" module="capital-calls" />);
    await userEvent.click(screen.getByRole('button', { name: /Beta GP/ }));
    const menu = screen.getByRole('menu', { name: 'Clients' });
    expect(within(menu).getByRole('menuitem', { name: /Alpha GP/ }).getAttribute('href')).toBe('/funds/f1');
  });

  it('is a picker even with only one client, saying it is the client', async () => {
    render(<Sidebar funds={funds.filter((f) => f.clientId === 'k1')} fundId="f1" module="capital-calls" />);
    const picker = screen.getByRole('button', { name: /Alpha GP/ });
    expect(picker.textContent).toContain('Client · 2 funds');
    await userEvent.click(picker);
    const items = within(screen.getByRole('menu', { name: 'Clients' })).getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('aria-current')).toBe('true');
  });
});

describe('the fund, in the top bar', () => {
  const show = (fundId: string) =>
    render(<TopBar funds={funds} fundId={fundId} callCount={2} crumb={{ leaf: 'Home' }} userInitials="FA" askTrigger={null} />);

  it('offers only this client’s funds', async () => {
    show('f1');
    await userEvent.click(screen.getByRole('button', { name: /Alpha Fund I/ }));
    const menu = screen.getByRole('menu', { name: 'Funds' });
    const items = within(menu).getAllByRole('menuitem').map((m) => m.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/Alpha Fund I$/);
    expect(items[1]).toMatch(/Alpha Fund II$/);
    expect(items[2]).toMatch(/New fund$/);
    expect(items.some((t) => t.includes('Beta'))).toBe(false);
  });

  it('makes a new fund for the client being worked in', async () => {
    show('f3');
    await userEvent.click(screen.getByRole('button', { name: /Beta Fund I/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /New fund/ }));
    await userEvent.type(screen.getByRole('textbox'), 'Beta Fund II');
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(createFund).toHaveBeenCalledWith('Beta Fund II', 'k2');
  });
});
