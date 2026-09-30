-- ---------------------------------------------------------------------------
-- Database tests: equalization statements
-- ---------------------------------------------------------------------------
-- Written only by the server; read by the fund's members; kept as sent; and
-- once one is sent, how the closing is settled is fixed.
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'alice@statements.example'),
       ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'bob@elsewhere.example');
insert into clients (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Statements Client'),
       ('11111111-1111-1111-1111-111111111112', 'Another Client');
insert into client_members (client_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a', 'admin'),
       ('11111111-1111-1111-1111-111111111112', 'bbbbbbbb-0000-0000-0000-00000000000b', 'admin');
insert into funds (id, client_id, name) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Statements Fund');
insert into investors (id, fund_id, lp_id, lp_name)
values ('44444444-4444-4444-4444-444444444407', '22222222-2222-2222-2222-222222222222', 'LP07', 'Eta');
insert into closings (id, fund_id, closing_no, closing_date)
values ('33333333-3333-3333-3333-333333333302', '22222222-2222-2222-2222-222222222222', 2, '2026-05-02');
select finalise_closing('33333333-3333-3333-3333-333333333302', '{"lines": []}'::jsonb, 'x', 'aaaaaaaa-0000-0000-0000-00000000000a', 'on_closing');

-- --- The server approves and sends ------------------------------------------

select throws_ok(
  $$ insert into closing_statements (closing_id, investor_id, status, approved_at, approved_by)
     values ('33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444407', 'approved', now(), 'aaaaaaaa-0000-0000-0000-00000000000a') $$,
  '23514', null, 'an approved statement must say when it is payable by'
);
select lives_ok(
  $$ insert into closing_statements (id, closing_id, investor_id, status, payment_due_date, approved_at, approved_by)
     values ('66666666-6666-6666-6666-666666666601', '33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444407', 'approved', '2026-05-15', now(), 'aaaaaaaa-0000-0000-0000-00000000000a') $$,
  'the server can approve a statement, payable by a date'
);
select lives_ok(
  $$ update closing_statements set payment_due_date = '2026-05-29' where id = '66666666-6666-6666-6666-666666666601' $$,
  'and, until it is sent, change that date'
);
select throws_ok(
  $$ update closing_statements set status = 'sent', sent_at = now() where id = '66666666-6666-6666-6666-666666666601' $$,
  '23514', null, 'a sent statement must carry what was sent and the equalization it came from'
);
select lives_ok(
  $$ update closing_statements
        set status = 'sent', sent_at = now(), payload = '{"line": {"net": 1}}'::jsonb,
            result_id = (select id from closing_results where closing_id = '33333333-3333-3333-3333-333333333302')
      where id = '66666666-6666-6666-6666-666666666601' $$,
  'and send it, with its evidence'
);

-- --- What was sent stays -------------------------------------------------------

select throws_ok(
  $$ update closing_statements set payload = '{}'::jsonb where id = '66666666-6666-6666-6666-666666666601' $$,
  '23001', null, 'what was sent cannot change'
);
select throws_ok(
  $$ update closing_statements set status = 'approved' where id = '66666666-6666-6666-6666-666666666601' $$,
  '23001', null, 'nor go back to approved'
);
select throws_ok(
  $$ update closing_statements set payment_due_date = '2026-06-30' where id = '66666666-6666-6666-6666-666666666601' $$,
  '23001', null, 'nor its payment due date: interest ran to it'
);
select throws_ok(
  $$ delete from closing_statements where id = '66666666-6666-6666-6666-666666666601' $$,
  '23001', null, 'nor be deleted'
);
select lives_ok(
  $$ update closing_statements set email_status = 'failed', email_error = 'bounced', email_attempted_at = now()
      where id = '66666666-6666-6666-6666-666666666601' $$,
  'but its delivery can be recorded, for a retry'
);
select throws_ok(
  $$ update closings set settlement = 'next_call' where id = '33333333-3333-3333-3333-333333333302' $$,
  '23001', null, 'and once a statement is sent, how the closing is settled is fixed'
);

-- A statement sent before dates were recorded has none, and can still be emailed again.
insert into investors (id, fund_id, lp_id, lp_name)
values ('44444444-4444-4444-4444-444444444401', '22222222-2222-2222-2222-222222222222', 'LP01', 'Alpha');
insert into closing_statements (id, closing_id, investor_id, status, sent_at, payload, result_id)
values ('66666666-6666-6666-6666-666666666602', '33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444401', 'sent', now(),
        '{"line": {"net": -1}}'::jsonb, (select id from closing_results where closing_id = '33333333-3333-3333-3333-333333333302'));
select lives_ok(
  $$ update closing_statements set email_status = 'delivered', email_attempted_at = now() where id = '66666666-6666-6666-6666-666666666602' $$,
  'a statement sent before dates were recorded can still have its delivery recorded'
);

-- --- Browsers read, and only their own fund's ---------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-00000000000a", "role": "authenticated"}';
select is((select count(*) from closing_statements), 2::bigint, 'a member of the fund sees its statements');
select throws_ok(
  $$ insert into closing_statements (closing_id, investor_id) values ('33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444407') $$,
  '42501', null, 'but cannot write one'
);

set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*) from closing_statements), 0::bigint, 'someone from another client sees none');

select * from finish();
rollback;
