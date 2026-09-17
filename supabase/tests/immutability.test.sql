-- ---------------------------------------------------------------------------
-- Database tests: stage derivation and the immutability of issued calls
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- These rules are the reason the schema is shaped the way it is, so they are
-- tested against a real Postgres rather than assumed. Every assertion below is
-- something that would let an issued capital call be silently rewritten if it
-- stopped holding.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);


-- --- Fixtures --------------------------------------------------------------

insert into firms (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Test Fund Administrators');

insert into clients (id, firm_id, name)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Illustrative Fund II, L.P.');

insert into investors (id, client_id, lp_id, lp_name, contact_email)
values ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222',
        'LP01', 'Alpha Pension Trust', 'treasury@alphapension.example'),
       ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222',
        'LP02', 'Beta University Endowment', 'investments@betaendowment.example');

insert into calls (id, client_id, call_no, fund_name, call_date, payment_due_date)
values ('55555555-5555-5555-5555-555555555555',
        '22222222-2222-2222-2222-222222222222',
        2, 'Illustrative Fund II, L.P.', '2026-09-30', '2026-10-14');


-- --- Stage derivation ------------------------------------------------------

select is(
  (select stage from call_stages where call_id = '55555555-5555-5555-5555-555555555555'),
  'not_started',
  'a call with no register and no components is not started'
);

insert into call_register (call_id, investor_id, commitment, opening_ucc, opening_paid_in)
values ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 10000000, 8000000, 2000000),
       ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 7500000, 6750000, 750000);

insert into call_components (call_id, component_id, component_name, total_amount)
values ('55555555-5555-5555-5555-555555555555', 'C1', 'Deal X', 3000000);

select is(
  (select stage from call_stages where call_id = '55555555-5555-5555-5555-555555555555'),
  'in_progress',
  'a call with inputs but nothing sent is in progress'
);

select is(
  (select active_investors from call_stages where call_id = '55555555-5555-5555-5555-555555555555'),
  2::bigint,
  'active investors are counted from the register'
);


-- --- Inputs are editable while the call is open ----------------------------

select lives_ok(
  $$ update call_register set commitment = 11000000
      where call_id = '55555555-5555-5555-5555-555555555555'
        and investor_id = '33333333-3333-3333-3333-333333333333' $$,
  'the register can be edited while the call is open'
);

select lives_ok(
  $$ update calls set call_date = '2026-09-29'
      where id = '55555555-5555-5555-5555-555555555555' $$,
  'call setup can be edited while the call is open'
);

select is(
  (select locked_at from calls where id = '55555555-5555-5555-5555-555555555555'),
  null,
  'an open call is not locked'
);


-- --- A snapshot, then the first send ---------------------------------------

insert into call_results (id, call_id, engine_version, totals, rows)
values ('66666666-6666-6666-6666-666666666666',
        '55555555-5555-5555-5555-555555555555',
        'test-sha',
        '{"total": 3000000, "reduces": 3000000}'::jsonb,
        '[]'::jsonb);

insert into notices (call_id, investor_id, status, sent_at, sent_to_email, payload, result_id)
values ('55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333',
        'sent', now(), 'treasury@alphapension.example',
        '{"total": "1,393,719.91"}'::jsonb,
        '66666666-6666-6666-6666-666666666666');

select isnt(
  (select locked_at from calls where id = '55555555-5555-5555-5555-555555555555'),
  null,
  'sending the first notice locks the call'
);

select is(
  (select stage from call_stages where call_id = '55555555-5555-5555-5555-555555555555'),
  'partially_sent',
  'one of two investors sent is partially sent'
);


-- --- Everything about the call is now frozen -------------------------------

select throws_ok(
  $$ update call_register set commitment = 99999999
      where call_id = '55555555-5555-5555-5555-555555555555'
        and investor_id = '33333333-3333-3333-3333-333333333333' $$,
  '23001',
  null,
  'the register cannot be edited after a notice has been sent'
);

select throws_ok(
  $$ insert into call_components (call_id, component_id, component_name, total_amount)
     values ('55555555-5555-5555-5555-555555555555', 'C2', 'Deal Y', 2000000) $$,
  '23001',
  null,
  'components cannot be added after a notice has been sent'
);

select throws_ok(
  $$ delete from call_components where call_id = '55555555-5555-5555-5555-555555555555' $$,
  '23001',
  null,
  'components cannot be deleted after a notice has been sent'
);

select throws_ok(
  $$ update calls set call_date = '2027-01-01'
      where id = '55555555-5555-5555-5555-555555555555' $$,
  '23001',
  null,
  'call setup cannot be edited after a notice has been sent'
);

select throws_ok(
  $$ delete from calls where id = '55555555-5555-5555-5555-555555555555' $$,
  '23001',
  null,
  'an issued call cannot be deleted'
);


-- --- Snapshots and sent notices keep their evidence ------------------------

select throws_ok(
  $$ update call_results set totals = '{"total": 1}'::jsonb
      where id = '66666666-6666-6666-6666-666666666666' $$,
  '23001',
  null,
  'a computed snapshot cannot be amended'
);

select throws_ok(
  $$ delete from call_results where id = '66666666-6666-6666-6666-666666666666' $$,
  '23001',
  null,
  'a computed snapshot cannot be deleted'
);

select throws_ok(
  $$ update notices set payload = '{"total": "0.00"}'::jsonb
      where call_id = '55555555-5555-5555-5555-555555555555'
        and investor_id = '33333333-3333-3333-3333-333333333333' $$,
  '23001',
  null,
  'the payload of a sent notice cannot be rewritten'
);

-- A mis-send can still be walked back; only the evidence is protected.
select lives_ok(
  $$ update notices set status = 'draft'
      where call_id = '55555555-5555-5555-5555-555555555555'
        and investor_id = '33333333-3333-3333-3333-333333333333' $$,
  'a sent notice can be marked unsent without touching its delivery record'
);


-- --- Audit log is append-only ----------------------------------------------

insert into audit_log (firm_id, client_id, call_id, action)
values ('11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '55555555-5555-5555-5555-555555555555',
        'notice.sent');

select throws_ok(
  $$ delete from audit_log where action = 'notice.sent' $$,
  '23001',
  null,
  'audit log entries cannot be deleted'
);


select * from finish();

rollback;
