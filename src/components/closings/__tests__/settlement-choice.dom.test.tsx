// @vitest-environment jsdom

/**
 * Choosing how a finalised closing's equalization is settled, actually clicked.
 *
 * What matters: a closing with no choice says so; the choice is saved only when
 * someone presses Save, as a request naming the choice and nothing else; and
 * once a sent call has settled it, it cannot be changed.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettlementCard } from '../settlement-choice';

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ settlement: 'next_call' }), { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockClear();
});

const show = (props: Partial<Parameters<typeof SettlementCard>[0]> = {}) => {
  const onChanged = vi.fn();
  render(
    <SettlementCard
      fundId="fund-1"
      closingId="c2"
      closingNo={2}
      settlement={null}
      settledOn={[]}
      statementsSent={0}
      canWrite
      onChanged={onChanged}
      {...props}
    />,
  );
  return onChanged;
};

describe('a closing nobody has said how to settle', () => {
  it('says so, and that calls after it wait for the choice', () => {
    show();
    expect(screen.getByRole('alert').textContent).toContain('Calls after it cannot be approved until this is chosen.');
  });

  it('saves nothing until Save, then sends only the choice', async () => {
    const onChanged = show();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: /On the next capital call/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(save);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/funds/fund-1/closings/c2/settlement');
    expect(JSON.parse(String(init.body))).toEqual({ settlement: 'next_call' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the server’s refusal instead of pretending it worked', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Nope.' }), { status: 409 }));
    const onChanged = show({ settlement: 'on_closing' });
    await userEvent.click(screen.getByRole('radio', { name: /On the next capital call/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('Nope.');
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('a closing whose statements have gone out', () => {
  it('is fixed too', () => {
    show({ settlement: 'on_closing', statementsSent: 2 });
    expect(screen.getByText('2 statements sent: fixed')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /On the next capital call/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('a closing a sent call has settled', () => {
  it('is fixed: the choice is shown and cannot be changed', () => {
    show({ settlement: 'next_call', settledOn: [3] });
    expect(screen.getByText('settled on Call No. 3: fixed')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /On the next capital call/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Settle now/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
