-- ---------------------------------------------------------------------------
-- A draft call may be incomplete
-- ---------------------------------------------------------------------------
-- `reporting_currency` and `rounding_decimals` were NOT NULL with defaults, and
-- the two fee-basis columns defaulted to 'Commitment'. That made it impossible
-- to store "not decided yet", so a new call was seeded from the illustrative
-- fixture and arrived carrying another fund's economics — a 2% fee, a 1.5m
-- organizational cap, LP04 as the rounding plug — that nobody had chosen.
--
-- Setting up a call is data entry that happens over time: some of it comes from
-- a workbook, some is carried forward from the previous call, some is typed.
-- Until it is issued it is a draft, and a draft is allowed to have holes. What
-- must not happen is the database quietly filling them in.
--
-- The format checks stay. "Three uppercase letters IF set" is structure, and
-- the database still owns that. "Always set" is a rule about when a call is
-- ready to issue, which the engine reports and `canApprove` enforces.
-- ---------------------------------------------------------------------------

alter table calls
  alter column reporting_currency drop not null,
  alter column reporting_currency drop default,
  alter column rounding_decimals  drop not null,
  alter column rounding_decimals  drop default,
  alter column default_mgmt_fee_basis drop default,
  alter column fee_basis             drop default;

-- The existing constraints reject NULL for currency; re-state them so an unset
-- value is allowed and a set one is still checked. `between` already yields
-- NULL (not false) for a NULL input, so rounding_decimals needs no change.
alter table calls drop constraint if exists calls_reporting_currency_check;

alter table calls
  add constraint calls_reporting_currency_check
  check (reporting_currency is null or reporting_currency ~ '^[A-Z]{3}$');

comment on column calls.reporting_currency is
  'ISO code. NULL until chosen — notices fall back to USD for display only.';
comment on column calls.rounding_decimals is
  'Decimal places for every allocation. NULL until chosen; the engine treats that as 2.';
