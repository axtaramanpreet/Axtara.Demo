-- ---------------------------------------------------------------------------
-- Fee runs are gone: the management fee is read from the calls that bill it
-- ---------------------------------------------------------------------------
-- A fee run was a period's fee, recorded by hand, so that a later change had
-- something to be trued up against. Calls now bill the fee period by period
-- (calls.fee_schedule), and what a call billed is that record: Management fees
-- compares every period with what calls billed, on its own, and shows what is
-- still owed or was billed beyond it. Recording by hand was a step nobody
-- needed and a figure that could disagree with the calls, so it is removed —
-- its rows with it, as agreed.
-- ---------------------------------------------------------------------------

drop table fee_runs;
drop function reject_fee_run_change();
