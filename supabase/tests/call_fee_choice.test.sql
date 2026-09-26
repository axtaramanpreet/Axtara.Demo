-- ---------------------------------------------------------------------------
-- Database tests: a call leaving the management fee out
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into clients (id, name) values ('11111111-1111-1111-1111-111111111111', 'Fee Choice Client');
insert into funds (id, client_id, name) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Fee Choice Fund');
insert into calls (id, fund_id, call_no, fund_name) values ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 2, 'Fee Choice Fund');

select is((select charge_mgmt_fee from calls where id = '55555555-5555-5555-5555-555555555555'), true, 'a call charges the fee unless told otherwise');

select lives_ok($$ select save_call_inputs('55555555-5555-5555-5555-555555555555', '{"charge_mgmt_fee": false}'::jsonb, '{}'::jsonb, null, null, null, null, null) $$, 'a call can leave it out');
select is((select charge_mgmt_fee from calls where id = '55555555-5555-5555-5555-555555555555'), false, 'and that is saved');

select lives_ok($$ select save_call_inputs('55555555-5555-5555-5555-555555555555',
  '{"fee_schedule": [{"from": "2026-04-01", "to": "2026-06-30", "label": "Q2 2026", "byLp": {"LP01": 125000}}]}'::jsonb,
  '{}'::jsonb, null, null, null, null, null) $$, 'a call saves the fee periods it bills');
select is((select fee_schedule -> 0 ->> 'label' from calls where id = '55555555-5555-5555-5555-555555555555'), 'Q2 2026', 'and they read back');
select throws_ok($$ update calls set fee_schedule = '{"not": "a list"}'::jsonb where id = '55555555-5555-5555-5555-555555555555' $$, '23514', null, 'a schedule is a list of periods');

update calls set locked_at = now() where id = '55555555-5555-5555-5555-555555555555';
select throws_ok($$ update calls set fee_schedule = '[]'::jsonb where id = '55555555-5555-5555-5555-555555555555' $$, '23001', null, 'an issued call''s fee periods are frozen with it');

select * from finish();
rollback;
