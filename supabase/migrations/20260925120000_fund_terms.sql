-- ---------------------------------------------------------------------------
-- Fund terms: a fund's settings, set once and dated
-- ---------------------------------------------------------------------------
-- Until now a fund had a name and nothing else. Its currency, fee, rounding,
-- general partner and signatory lived on every call, copied each time, so
-- changing the fee meant editing it call by call and "what was the rate on
-- 15 March?" had no answer anywhere.
--
-- A row here is the fund's full set of terms from `effective_from` on. The
-- terms on a date are the latest row on or before it. Changing anything —
-- a new rate from 1 January, a fee basis that switches at the end of the
-- investment period — is a new row, never an edit, so the history a fee
-- true-up needs is always there.
--
-- A correction to a row already entered is also a new row with the same date;
-- where two share a date, the later-entered one wins. So the table only ever
-- grows, like `audit_log`.
--
-- Blank means "not set". Nothing is defaulted here: the engine applies a
-- default, and the Settings screen says which values are still on one, so a
-- default is never mistaken for a term somebody read out of the LPA.
--
-- Calls keep their own copy of the terms they used. This table only pre-fills
-- a new call; it changes nothing about a call that exists.
-- ---------------------------------------------------------------------------

create table fund_terms (
  id                         uuid primary key default gen_random_uuid(),
  fund_id                    uuid not null references funds (id) on delete cascade,
  effective_from             date not null,

  -- Reporting and rounding
  reporting_currency         text check (reporting_currency is null or reporting_currency ~ '^[A-Z]{3}$'),
  rounding_decimals          smallint check (rounding_decimals is null or rounding_decimals between 0 and 4),
  rounding_plug_lp_id        text,

  -- Management fee
  fee_basis                  text,
  fee_rate_annual            rate_fraction,
  fee_period_fraction        rate_fraction,
  fee_reduces_unfunded       boolean,
  fee_exempt_lp_ids          text[] not null default '{}',
  org_expense_cap            money_amount,

  -- Who the notice is from
  gp_name                    text,
  signatory_name             text,
  signatory_title            text,

  -- The fund's life
  investment_period_end      date,
  fund_term_end              date,

  -- LPA terms. Each fund's agreement sets these differently. The choices are
  -- the ones the engine knows how to apply; anything else would be a value
  -- nothing could act on.
  fee_timing                 text check (fee_timing is null or fee_timing in ('advance', 'arrears')),
  fee_day_count              text check (fee_day_count is null or fee_day_count in
                               ('period_fraction', 'actual_365', 'actual_360', '30_360')),
  late_close_interest_rate   rate_fraction,
  late_close_interest_basis  text check (late_close_interest_basis is null or late_close_interest_basis in ('simple', 'compound')),
  catch_up_fee_to            text check (catch_up_fee_to is null or catch_up_fee_to in ('gp', 'existing_lps')),
  equalization_interest_to   text check (equalization_interest_to is null or equalization_interest_to in ('existing_lps', 'fund', 'gp')),

  note                       text,
  created_at                 timestamptz not null default now(),
  created_by                 uuid references auth.users (id) default auth.uid()
);

create index fund_terms_fund_idx on fund_terms (fund_id, effective_from desc, created_at desc);


-- --- Only ever added to ----------------------------------------------------

-- One exception: deleting a whole fund takes its terms with it. A fund made by
-- mistake can be deleted (20260918090000_delete_empty_client), and refusing
-- here would make that impossible the moment anyone had typed its terms. The
-- cascade runs after the fund's row is gone, so "the fund no longer exists" is
-- how that case is told apart from deleting one row of history.

create or replace function reject_fund_terms_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from funds where id = old.fund_id) then
    return old;
  end if;
  raise exception
    'Fund terms are never edited. Record the change as new terms from the date it applies.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger fund_terms_append_only
  before update or delete on fund_terms
  for each row execute function reject_fund_terms_change();


-- --- Who may see and add ---------------------------------------------------
-- Read: anyone who can see the fund. Add: anyone who can change the fund.
-- No update or delete policy, and the trigger above refuses both regardless.

alter table fund_terms enable row level security;

create policy fund_terms_read on fund_terms
  for select to authenticated
  using (fund_id in (select auth_fund_ids()));

create policy fund_terms_insert on fund_terms
  for insert to authenticated
  with check (auth_can_write_fund(fund_id));


notify pgrst, 'reload schema';
