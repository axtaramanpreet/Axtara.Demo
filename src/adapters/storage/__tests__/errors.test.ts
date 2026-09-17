/**
 * The database refuses some writes on purpose. These check that those refusals
 * reach the accountant as an explanation rather than a constraint name.
 */

import { describe, expect, it } from 'vitest';
import { asError } from '../supabase-repository';

describe('database refusals, explained', () => {
  it('explains that an issued call cannot be changed', () => {
    const message = asError(
      { code: '23001', message: 'Capital call abc was issued on 2026-09-30 …' },
      'save the call inputs',
    ).message;

    expect(message).toMatch(/has been issued/i);
    // It has to say what to do instead, not just that the door is shut.
    expect(message).toMatch(/new call/i);
  });

  it('explains that sending is the server’s job, not the browser’s', () => {
    const message = asError(
      { code: '42501', message: 'new row violates row-level security policy' },
      'record a notice as sent',
    ).message;

    expect(message).toMatch(/permission/i);
    expect(message).toMatch(/record a notice as sent/);
  });

  it('passes anything else through with the action that failed', () => {
    const message = asError({ code: '08006', message: 'connection failure' }, 'load the register')
      .message;

    expect(message).toBe('Could not load the register: connection failure');
  });
});
