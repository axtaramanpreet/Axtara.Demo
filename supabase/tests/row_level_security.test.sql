-- ---------------------------------------------------------------------------
-- Database tests: tenancy isolation and write authority
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- Two claims are checked here, both of which the product depends on:
--
--   1. A signed-in user reaches their own client's funds and nothing else.
--   2. Telling an investor money is due cannot originate in a browser. The
--      `notices`, `call_results` and `audit_log` tables have no write policy,
--      so those writes are refused for every signed-in user and can only be
--      performed by server-side code holding the service role.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);


-- --- Two clients, two users, one fund each -----------------------------------

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
       -- Carol can read Client A but not change anything.
       ('aaaa1111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-00000000000c', 'viewer');

insert into funds (id, client_id, name)
values ('aaaa2222-2222-2222-2222-222222222222', 'aaaa1111-1111-1111-1111-111111111111', 'Fund A I, L.P.'),
       ('bbbb2222-2222-2222-2222-222222222222', 'bbbb1111-1111-1111-1111-111111111111', 'Fund B I, L.P.');

insert into calls (id, fund_id, call_no, fund_name)
values ('aaaa3333-3333-3333-3333-333333333333', 'aaaa2222-2222-2222-2222-222222222222', 1, 'Fund A I, L.P.'),
       ('bbbb3333-3333-3333-3333-333333333333', 'bbbb2222-2222-2222-2222-222222222222', 1, 'Fund B I, L.P.');

insert into investors (id, fund_id, lp_id, lp_name)
values ('aaaa5555-5555-5555-5555-555555555555', 'aaaa2222-2222-2222-2222-222222222222', 'LP01', 'Fund A Investor');

insert into call_results (id, call_id, engine_version, totals, rows)
values ('aaaa4444-4444-4444-4444-444444444444', 'aaaa3333-3333-3333-3333-333333333333',
        'test-sha', '{"total": 1}'::jsonb, '[]'::jsonb);


-- --- Alice, an admin at Client A ---------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-00000000000a", "role": "authenticated"}';

select is(
  (select count(*) from funds),
  1::bigint,
  'a member sees only their own client''s funds'
);

select is(
  (select name from funds),
  'Fund A I, L.P.',
  'and it is the right one'
);

select is(
  (select count(*) from calls),
  1::bigint,
  'calls are scoped to the client''s funds'
);

select lives_ok(
  $$ insert into call_components (call_id, component_id, component_name, total_amount)
     values ('aaaa3333-3333-3333-3333-333333333333', 'C1', 'Deal X', 1000000) $$,
  'an admin can add components to their own fund''s call'
);

select is(
  (select count(*) from call_results),
  1::bigint,
  'snapshots for the client''s own calls are readable'
);

-- The security boundary: these three writes must be impossible from a browser.
-- Even creating a draft is refused, because approving a notice is itself an
-- authority action gated on the tie-out checks passing — a rule the server has
-- to own, or a browser could approve its way past a failing check.
select throws_ok(
  $$ insert into notices (call_id, investor_id, status)
     values ('aaaa3333-3333-3333-3333-333333333333',
             'aaaa5555-5555-5555-5555-555555555555', 'draft') $$,
  '42501',
  null,
  'a signed-in user cannot create or send a notice'
);

select throws_ok(
  $$ insert into call_results (call_id, engine_version, totals, rows)
     values ('aaaa3333-3333-3333-3333-333333333333', 'forged', '{}'::jsonb, '[]'::jsonb) $$,
  '42501',
  null,
  'a signed-in user cannot write a computed snapshot'
);

select throws_ok(
  $$ insert into audit_log (client_id, action) values ('aaaa1111-1111-1111-1111-111111111111', 'forged') $$,
  '42501',
  null,
  'a signed-in user cannot write to the audit log'
);


-- --- Bob, at Client B, must not see Client A -----------------------------------

set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-00000000000b", "role": "authenticated"}';

select is(
  (select count(*) from funds where id = 'aaaa2222-2222-2222-2222-222222222222'),
  0::bigint,
  'another client''s fund is invisible'
);

select is(
  (select count(*) from call_results),
  0::bigint,
  'another client''s snapshots are invisible'
);

select throws_ok(
  $$ insert into call_components (call_id, component_id, component_name, total_amount)
     values ('aaaa3333-3333-3333-3333-333333333333', 'C9', 'Injected', 1) $$,
  '42501',
  null,
  'another client''s call cannot be written to'
);


-- --- Carol, a viewer at Client A: read yes, write no -------------------------

set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-00000000000c", "role": "authenticated"}';

select throws_ok(
  $$ insert into call_components (call_id, component_id, component_name, total_amount)
     values ('aaaa3333-3333-3333-3333-333333333333', 'C8', 'Viewer edit', 1) $$,
  '42501',
  null,
  'a viewer cannot change call inputs'
);


select * from finish();

rollback;
