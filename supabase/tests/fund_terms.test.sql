-- ---------------------------------------------------------------------------
-- Database tests: fund terms
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- Three claims: terms are scoped to the client like everything else; only
-- someone who may change a fund may add to them; and history is never
-- rewritten — a change is a new row, a row is never edited or removed, except
-- when the whole fund goes.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);


-- --- Two clients; an admin and a viewer at one, an admin at the other -------

insert into auth.users (id, instance_id, aud, role, email)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'alice@client-a.example'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'bob@client-b.example'),
       ('cccccccc-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'carol@client-a.example');

insert into clients (id, name)
values ('aaaa1111-1111-1111-1111-111111111111', 'Client A'),
       ('bbbb1111-1111-1111-1111-111111111111', 'Client B');

insert into client_members (client_id, user_id, role)
values ('aaaa1111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a', 'admin'),
       ('bbbb1111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-00000000000b', 'admin'),
       ('aaaa1111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-00000000000c', 'viewer');

insert into funds (id, client_id, name)
values ('aaaa2222-2222-2222-2222-222222222222', 'aaaa1111-1111-1111-1111-111111111111', 'Fund A I, L.P.'),
       ('aaaa2222-2222-2222-2222-999999999999', 'aaaa1111-1111-1111-1111-111111111111', 'Fund A Mistake');


-- --- Alice, an admin at Client A, records the fund's terms ------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-00000000000a", "role": "authenticated"}';

select lives_ok(
  $$ insert into fund_terms (fund_id, effective_from, reporting_currency, fee_rate_annual, fee_basis)
     values ('aaaa2222-2222-2222-2222-222222222222', '2024-01-01', 'USD', 0.02, 'Commitment') $$,
  'someone who may change the fund can record its terms'
);

select lives_ok(
  $$ insert into fund_terms (fund_id, effective_from, reporting_currency, fee_rate_annual, fee_basis)
     values ('aaaa2222-2222-2222-2222-222222222222', '2029-01-01', 'USD', 0.015, 'Invested_Capital') $$,
  'a later change is a new row, dated'
);

select is(
  (select created_by from fund_terms where effective_from = '2024-01-01'),
  'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
  'each row records who entered it'
);

select throws_ok(
  $$ insert into fund_terms (fund_id, effective_from, fee_timing)
     values ('aaaa2222-2222-2222-2222-222222222222', '2025-01-01', 'whenever') $$,
  '23514',
  null,
  'an LPA setting has to be one the engine knows'
);

select throws_ok(
  $$ insert into fund_terms (fund_id, effective_from, reporting_currency)
     values ('aaaa2222-2222-2222-2222-222222222222', '2025-01-01', 'dollars') $$,
  '23514',
  null,
  'a currency is a three-letter code'
);

insert into fund_terms (fund_id, effective_from, reporting_currency)
values ('aaaa2222-2222-2222-2222-999999999999', '2024-01-01', 'EUR');


-- --- Carol can read Client A but not change it ------------------------------

set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-00000000000c", "role": "authenticated"}';

select is(
  (select count(*) from fund_terms where fund_id = 'aaaa2222-2222-2222-2222-222222222222'),
  2::bigint,
  'a viewer sees the fund''s terms'
);

select throws_ok(
  $$ insert into fund_terms (fund_id, effective_from, fee_rate_annual)
     values ('aaaa2222-2222-2222-2222-222222222222', '2030-01-01', 0) $$,
  '42501',
  null,
  'but cannot add to them'
);


-- --- Bob, at another client, sees none of it --------------------------------

set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-00000000000b", "role": "authenticated"}';

select is(
  (select count(*) from fund_terms),
  0::bigint,
  'another client''s terms are invisible'
);


-- --- History is never rewritten, by anyone ---------------------------------

reset role;

select throws_ok(
  $$ update fund_terms set fee_rate_annual = 0.01 where effective_from = '2024-01-01' $$,
  '23001',
  null,
  'a recorded term cannot be edited, even by the server'
);

select throws_ok(
  $$ delete from fund_terms where effective_from = '2029-01-01' $$,
  '23001',
  null,
  'and a row of history cannot be removed'
);


-- --- ...except when the whole fund goes ------------------------------------

select lives_ok(
  $$ delete from funds where id = 'aaaa2222-2222-2222-2222-999999999999' $$,
  'a fund made by mistake can still be deleted once it has terms'
);

select is(
  (select count(*) from fund_terms where fund_id = 'aaaa2222-2222-2222-2222-999999999999'),
  0::bigint,
  'and its terms go with it'
);


-- --- When equalization interest runs to, and interest on the catch-up fee ---

select lives_ok(
  $$ insert into fund_terms (fund_id, effective_from, late_close_interest_rate, equalization_interest_until, catch_up_fee_interest, catch_up_fee_until)
     values ('aaaa2222-2222-2222-2222-222222222222', '2030-01-01', 0.08, 'collection_due_date', 'per_period', 'billed_periods') $$,
  'the terms record when interest runs to and how the catch-up fee carries it'
);

select throws_ok(
  $$ insert into fund_terms (fund_id, effective_from, equalization_interest_until)
     values ('aaaa2222-2222-2222-2222-222222222222', '2031-01-01', 'whenever') $$,
  '23514',
  null,
  'only the closing date or the collecting due date'
);

select throws_ok(
  $$ insert into fund_terms (fund_id, effective_from, catch_up_fee_interest)
     values ('aaaa2222-2222-2222-2222-222222222222', '2031-01-01', 'daily') $$,
  '23514',
  null,
  'only none, from the first close, or per period'
);

select throws_ok(
  $$ insert into fund_terms (fund_id, effective_from, catch_up_fee_until)
     values ('aaaa2222-2222-2222-2222-222222222222', '2031-01-01', 'whenever') $$,
  '23514',
  null,
  'the catch-up fee covers the billed periods or runs to the closing, nothing else'
);


select * from finish();

rollback;
