-- ---------------------------------------------------------------------------
-- A rate of its own for interest on the catch-up fee
-- ---------------------------------------------------------------------------
-- Some LPAs charge a different rate on the catch-up management fee than on a
-- late investor's share of earlier calls. Blank uses the late-close interest
-- rate, as before, so nothing already recorded changes.
-- ---------------------------------------------------------------------------

alter table fund_terms
  add column catch_up_fee_interest_rate rate_fraction;

comment on column fund_terms.catch_up_fee_interest_rate is
  'Interest a year on the catch-up management fee. Blank: late_close_interest_rate.';
