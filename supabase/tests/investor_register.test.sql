-- ---------------------------------------------------------------------------
-- Database tests: the investor register
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- An investor's profile is the Investors page's. Saving a call or a closing
-- may add an investor it does not know, and a detail typed on it still
-- updates the profile — but a blank never wipes one, and a closing never
-- resets the type it does not carry.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into clients (id, name) values ('11111111-1111-1111-1111-111111111111', 'Register Test Client');
insert into funds (id, client_id, name)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Register Test Fund');
insert into calls (id, fund_id, call_no, fund_name)
values ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 1, 'Register Test Fund');
insert into closings (id, fund_id, closing_no, closing_date)
values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 1, '2026-01-15');

-- A full profile, as the Investors page would record it.
insert into investors (fund_id, lp_id, lp_name, lp_type, contact_email, notes, country, is_gp, kyc_status, cc_emails)
values ('22222222-2222-2222-2222-222222222222', 'LP01', 'Alpha Pension Trust', 'Pension',
        'treasury@alpha.example', 'Quarterly reporting pack', 'Canada', false, 'approved',
        array['cfo@alpha.example']);

-- --- A call's register with blanks ---------------------------------------

select lives_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555', '{}'::jsonb, '{}'::jsonb,
    '[{"lp_id": "LP01", "lp_name": "", "lp_type": "", "contact_email": "", "notes": "",
       "commitment": 10000000, "opening_ucc": 10000000, "opening_paid_in": 0, "position": 0},
      {"lp_id": "LP09", "lp_name": "New Endowment", "lp_type": "",
       "commitment": 5000000, "opening_ucc": 5000000, "opening_paid_in": 0, "position": 1}]'::jsonb,
    null, null, null, null)
$$, 'a call saves a register with blank investor details');

select results_eq(
  $$ select lp_name, lp_type, contact_email, notes from investors
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP01' $$,
  $$ values ('Alpha Pension Trust', 'Pension', 'treasury@alpha.example', 'Quarterly reporting pack') $$,
  'and a blank on the call leaves the investor''s profile as it was'
);

select results_eq(
  $$ select country, kyc_status, cc_emails from investors
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP01' $$,
  $$ values ('Canada'::text, 'approved'::text, array['cfo@alpha.example']) $$,
  'including what only the Investors page records'
);

select results_eq(
  $$ select lp_name, lp_type from investors
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP09' $$,
  $$ values ('New Endowment', 'LP') $$,
  'an investor the fund did not know is created from the call'
);

select lives_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555', '{}'::jsonb, '{}'::jsonb,
    '[{"lp_id": "LP01", "lp_name": "Alpha Pension Trust (Canada)", "contact_email": "ops@alpha.example",
       "commitment": 10000000, "opening_ucc": 10000000, "opening_paid_in": 0, "position": 0}]'::jsonb,
    null, null, null, null)
$$, 'a call saves a register with a detail typed in');

select results_eq(
  $$ select lp_name, contact_email, lp_type from investors
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP01' $$,
  $$ values ('Alpha Pension Trust (Canada)', 'ops@alpha.example', 'Pension') $$,
  'and what was typed on the call updates the investor'
);

-- --- A closing -----------------------------------------------------------

select lives_ok($$
  select save_closing_commitments('66666666-6666-6666-6666-666666666666',
    '[{"lp_id": "LP01", "lp_name": "", "amount": 10000000},
      {"lp_id": "LP20", "lp_name": "Late Capital", "contact_email": "ir@late.example", "amount": 2000000}]'::jsonb)
$$, 'a closing saves who it admits');

select results_eq(
  $$ select lp_name, lp_type, contact_email from investors
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP01' $$,
  $$ values ('Alpha Pension Trust (Canada)', 'Pension', 'ops@alpha.example') $$,
  'without resetting the type, or blanking the name'
);

select results_eq(
  $$ select lp_name, contact_email from investors
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP20' $$,
  $$ values ('Late Capital', 'ir@late.example') $$,
  'and creates an investor the fund did not know'
);

-- --- The profile's own rules ---------------------------------------------

select throws_ok(
  $$ update investors set cc_emails = array['not an address']
      where fund_id = '22222222-2222-2222-2222-222222222222' and lp_id = 'LP01' $$,
  '23514', null,
  'a copy address has to be an email address'
);

select * from finish();
rollback;
