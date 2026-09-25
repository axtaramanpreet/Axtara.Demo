// @vitest-environment jsdom

/**
 * Fund setup's field table: the rounding plug and the currency are picked, not
 * typed, and an issued call still cannot be changed through either.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETUP_FIELDS } from '@/adapters/workbook/template-layout';
import { FieldTable } from '../field-table';

const investors = [
  { value: 'LP01', label: 'Alpha Pension Trust' },
  { value: 'LP04', label: 'Delta Insurance Co' },
];

afterEach(cleanup);

describe('the rounding plug in call setup', () => {
  it('is picked from this call’s investors', async () => {
    const onChange = vi.fn();
    render(<FieldTable fields={SETUP_FIELDS} values={{}} onChange={onChange} investors={investors} />);

    const plug = screen.getByRole('combobox', { name: 'Rounding_Plug_LP_ID' });
    await userEvent.click(plug);
    await userEvent.type(plug, 'delta{Enter}');
    expect(onChange).toHaveBeenCalledWith('Rounding_Plug_LP_ID', 'LP04');
  });

  it('offers only investors on the register', async () => {
    render(<FieldTable fields={SETUP_FIELDS} values={{}} onChange={() => {}} investors={investors} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Rounding_Plug_LP_ID' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'LP01Alpha Pension Trust',
      'LP04Delta Insurance Co',
    ]);
  });

  it('cannot be changed on an issued call', () => {
    render(
      <FieldTable fields={SETUP_FIELDS} values={{ Rounding_Plug_LP_ID: 'LP04' }} onChange={() => {}} investors={investors} readOnly />,
    );
    expect(screen.queryByRole('combobox', { name: 'Rounding_Plug_LP_ID' })).toBeNull();
    expect((screen.getByLabelText('Rounding_Plug_LP_ID') as HTMLInputElement).readOnly).toBe(true);
  });
});

describe('the currency in call setup', () => {
  it('is found by name and stored as its code', async () => {
    const onChange = vi.fn();
    render(<FieldTable fields={SETUP_FIELDS} values={{}} onChange={onChange} />);
    const currency = screen.getByRole('combobox', { name: 'Reporting_Currency' });
    await userEvent.click(currency);
    await userEvent.type(currency, 'euro{Enter}');
    expect(onChange).toHaveBeenCalledWith('Reporting_Currency', 'EUR');
  });
});
