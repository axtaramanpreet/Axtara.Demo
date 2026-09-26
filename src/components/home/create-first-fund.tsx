'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { NewFundDialog } from './new-fund-dialog';

/**
 * Creating the very first fund.
 *
 * The sidebar carries the same action, but the sidebar only renders on a fund's
 * own pages — so before there is a fund there is nowhere to click, and the
 * empty state has to carry its own way out. Without this the first sign-in is a
 * dead end: an account with a client, no funds, and no control that makes one.
 */
export function CreateFirstFund() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Create the first fund
      </Button>
      {open && <NewFundDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
