-- ---------------------------------------------------------------------------
-- Database tests: the fund position on Home
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- The position is read from a call's register: commitments, paid-in and
-- unfunded as they stood going into that call. Which call matters. A new call
-- starts empty, and reading the position from it reported a fund with 50.5m
-- committed as holding nothing — every line 0.00, the chart saying "27.9% of
-- USD 0" — while the card's own subtitle named the call before it.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);


-- --- A fund with one call set up and a newer one not started ---------------

insert into firms (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Test Fund Administrators');

insert into clients (id, firm_id, name)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'Illustrative Fund II, L.P.');

insert into investors (id, client_id, lp_id, lp_name)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'LP01', 'Alpha'),
       ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'LP02', 'Beta'),
       ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'LP03', 'Gamma');

-- Call 1: the register, with one investor who has left.
insert into calls (id, client_id, call_no, fund_name, call_date, payment_due_date)
values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222',
        1, 'Illustrative Fund II, L.P.', '2026-09-30', '2026-10-14');

insert into call_register (call_id, investor_id, commitment, opening_paid_in, opening_ucc, status)
values ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 10000000, 2000000, 8000000, 'Active'),
       ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',  7500000,  750000, 6750000, 'Active'),
       ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',  5000000, 2000000, 3000000, 'Transferred');

-- Call 2: just created. No register yet, no dates yet.
insert into calls (id, client_id, call_no, fund_name)
values ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222',
        2, 'Illustrative Fund II, L.P.');


-- --- The position comes from the newest call that has a register -----------

select is(
  (select total_commitments from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  17500000::numeric,
  'commitments come from the last call with a register, not the empty new one'
);

select is(
  (select paid_in_capital from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  2750000::numeric,
  'paid-in comes from the same register'
);

select is(
  (select unfunded_commitment from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  14750000::numeric,
  'unfunded comes from the same register'
);

select is(
  (select investors from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  2::bigint,
  'only active investors are counted'
);

select is(
  (select latest_call_no from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'the call it reads from is the one it says it reads from'
);

select is(
  (select next_payment_due from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  '2026-10-14'::date,
  'the next payment due is that call''s due date, not the blank new one'
);


-- --- Once the new call has a register, it becomes the position -------------

insert into call_register (call_id, investor_id, commitment, opening_paid_in, opening_ucc, status)
values ('77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', 10000000, 3393719.91, 6635983.06, 'Active');

select is(
  (select latest_call_no from client_positions where client_id = '22222222-2222-2222-2222-222222222222'),
  2,
  'a new call takes over as soon as it has a register'
);


select * from finish();

rollback;
