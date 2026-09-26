-- ---------------------------------------------------------------------------
-- Database tests: how a later closing's equalization is settled
-- ---------------------------------------------------------------------------
-- A finalised closing stays as it was, except for how its equalization is
-- settled — and that only until a sent call has settled part of it. A call
-- carries what it settles, and it is frozen with the call.
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'alice@settle.example');
insert into clients (id, name) values ('11111111-1111-1111-1111-111111111111', 'Settle Client');
insert into client_members (client_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a', 'admin');
insert into funds (id, client_id, name) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Settle Fund');
insert into closings (id, fund_id, closing_no, closing_date)
values ('33333333-3333-3333-3333-333333333302', '22222222-2222-2222-2222-222222222222', 2, '2026-05-02');
insert into calls (id, fund_id, call_no, fund_name)
values ('55555555-5555-5555-5555-555555555502', '22222222-2222-2222-2222-222222222222', 2, 'Settle Fund');

-- --- Finalising records the choice -----------------------------------------

select lives_ok(
  $$ select finalise_closing('33333333-3333-3333-3333-333333333302', '{"lines": []}'::jsonb, 'x', 'aaaaaaaa-0000-0000-0000-00000000000a', 'on_closing') $$,
  'finalising records how the equalization is settled'
);
select is((select settlement from closings where id = '33333333-3333-3333-3333-333333333302'), 'on_closing', 'and it reads back');

select throws_ok(
  $$ update closings set settlement = 'later' where id = '33333333-3333-3333-3333-333333333302' $$,
  '23514', null, 'only the two ways are allowed'
);

-- --- It can change after finalising, and nothing else can -------------------

select lives_ok(
  $$ update closings set settlement = 'next_call' where id = '33333333-3333-3333-3333-333333333302' $$,
  'a finalised closing can change how it is settled'
);
select throws_ok(
  $$ update closings set settlement = 'on_closing', note = 'and this' where id = '33333333-3333-3333-3333-333333333302' $$,
  '23001', null, 'but nothing else with it'
);
select throws_ok(
  $$ update closings set settlement = null where id = '33333333-3333-3333-3333-333333333302' $$,
  '23001', null, 'nor go back to not chosen'
);

-- --- The browser cannot choose it: the server does ---------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ update closings set settlement = 'on_closing' where id = '33333333-3333-3333-3333-333333333302' $$,
  '42501', null, 'a signed-in user cannot set it directly'
);
reset role;

-- --- A call carries it, frozen once sent --------------------------------------

select lives_ok(
  $$ select save_call_inputs('55555555-5555-5555-5555-555555555502',
       '{"equalization_schedule": [{"closingId": "33333333-3333-3333-3333-333333333302", "closingNo": 2, "closingDate": "2026-05-02", "byLp": {"LP03": 67032.97, "LP01": -67032.97}}]}'::jsonb,
       '{}'::jsonb, null, null, null, null, null) $$,
  'a call saves the equalization it settles'
);
select is(
  (select equalization_schedule -> 0 -> 'byLp' ->> 'LP03' from calls where id = '55555555-5555-5555-5555-555555555502'),
  '67032.97', 'and it reads back'
);

update calls set locked_at = now() where id = '55555555-5555-5555-5555-555555555502';
select throws_ok(
  $$ update calls set equalization_schedule = '[]'::jsonb where id = '55555555-5555-5555-5555-555555555502' $$,
  '23001', null, 'a sent call''s equalization is frozen with it'
);
select throws_ok(
  $$ update closings set settlement = 'on_closing' where id = '33333333-3333-3333-3333-333333333302' $$,
  '23001', null, 'and once a sent call settled it, how it is settled is fixed'
);

select * from finish();
rollback;
