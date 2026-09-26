-- ---------------------------------------------------------------------------
-- Database tests: closings and equalization results
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- Drafts are the accountant's to type; fixing the figures is the server's; and
-- once fixed, nothing changes — not a finalised closing, not what it admitted,
-- not its equalization.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);


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
values ('aaaa2222-2222-2222-2222-222222222222', 'aaaa1111-1111-1111-1111-111111111111', 'Fund A I, L.P.');

insert into investors (id, fund_id, lp_id, lp_name)
values ('aaaa5555-5555-5555-5555-555555555501', 'aaaa2222-2222-2222-2222-222222222222', 'LP01', 'Alpha'),
       ('aaaa5555-5555-5555-5555-555555555507', 'aaaa2222-2222-2222-2222-222222222222', 'LP07', 'Eta');


-- --- Alice drafts a closing -------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-00000000000a", "role": "authenticated"}';

select lives_ok(
  $$ insert into closings (id, fund_id, closing_no, closing_date)
     values ('aaaa6666-6666-6666-6666-666666666601', 'aaaa2222-2222-2222-2222-222222222222', 1, '2026-01-01') $$,
  'someone who may change the fund can draft a closing'
);

select lives_ok(
  $$ insert into closing_commitments (closing_id, investor_id, amount)
     values ('aaaa6666-6666-6666-6666-666666666601', 'aaaa5555-5555-5555-5555-555555555501', 6000000) $$,
  'and record who commits at it'
);

select lives_ok(
  $$ select save_closing_commitments('aaaa6666-6666-6666-6666-666666666601',
       '[{"lp_id": "LP01", "lp_name": "Alpha", "amount": 6000000, "position": 0},
         {"lp_id": "LP09", "lp_name": "Iota Family Office", "amount": 2500000, "fee_rate_override": 0.01, "position": 1}]'::jsonb) $$,
  'a draft closing''s investors are saved in one go'
);

select is(
  (select count(*) from investors where fund_id = 'aaaa2222-2222-2222-2222-222222222222' and lp_id = 'LP09'),
  1::bigint,
  'an investor new to the fund is created as they are admitted'
);

select throws_ok(
  $$ update closings set finalised_at = now() where closing_no = 1 $$,
  '42501',
  null,
  'but cannot mark it finalised: that is the server''s act'
);

select throws_ok(
  $$ insert into closings (fund_id, closing_no, closing_date, finalised_at)
     values ('aaaa2222-2222-2222-2222-222222222222', 2, '2026-08-01', now()) $$,
  '42501',
  null,
  'nor create one already finalised'
);

select throws_ok(
  $$ insert into closing_results (closing_id, engine_version, result)
     values ('aaaa6666-6666-6666-6666-666666666601', 'x', '{}') $$,
  '42501',
  null,
  'nor write an equalization result'
);



-- --- Carol only reads; Bob sees nothing ---------------------------------------

select throws_ok(
  $$ select finalise_closing('aaaa6666-6666-6666-6666-666666666601', '{}'::jsonb, 'x', 'aaaaaaaa-0000-0000-0000-00000000000a', null) $$,
  '42501', null, 'nor finalise it through the server''s own function'
);

set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-00000000000c", "role": "authenticated"}';

select is((select count(*) from closings), 1::bigint, 'a viewer sees the fund''s closings');

select throws_ok(
  $$ insert into closings (fund_id, closing_no, closing_date)
     values ('aaaa2222-2222-2222-2222-222222222222', 2, '2026-08-01') $$,
  '42501',
  null,
  'but cannot draft one'
);

set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-00000000000b", "role": "authenticated"}';

select is((select count(*) from closing_commitments), 0::bigint, 'another client sees none of it');


-- --- The server finalises; then nothing moves --------------------------------

reset role;

update closings set finalised_at = now() where id = 'aaaa6666-6666-6666-6666-666666666601';
insert into closing_results (closing_id, engine_version, result)
values ('aaaa6666-6666-6666-6666-666666666601', 'test', '{"lines": []}');

select throws_ok(
  $$ update closings set closing_date = '2026-02-01' where id = 'aaaa6666-6666-6666-6666-666666666601' $$,
  '23001', null, 'a finalised closing cannot be changed, even by the server'
);

select throws_ok(
  $$ insert into closing_commitments (closing_id, investor_id, amount)
     values ('aaaa6666-6666-6666-6666-666666666601', 'aaaa5555-5555-5555-5555-555555555507', 5000000) $$,
  '23001', null, 'nor can anyone be added to it'
);

select throws_ok(
  $$ select save_closing_commitments('aaaa6666-6666-6666-6666-666666666601',
       '[{"lp_id": "LP01", "lp_name": "Alpha", "amount": 1}]'::jsonb) $$,
  '23001', null, 'and saving it again is refused too'
);

select throws_ok(
  $$ update closing_commitments set amount = 1 where closing_id = 'aaaa6666-6666-6666-6666-666666666601' $$,
  '23001', null, 'nor what it admitted be edited'
);

select throws_ok(
  $$ update closing_results set result = '{}' $$,
  '23001', null, 'a frozen equalization cannot be edited'
);

-- The management fee is read from the calls that bill it; nothing is recorded by hand.
select hasnt_table('public', 'fee_runs', 'there is no table of fee runs recorded by hand');


select * from finish();

rollback;
