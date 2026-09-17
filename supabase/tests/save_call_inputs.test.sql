-- ---------------------------------------------------------------------------
-- Database tests: save_call_inputs
-- ---------------------------------------------------------------------------
-- Run with `supabase test db`.
--
-- The function exists for atomicity, so that is what gets tested: a save that
-- fails partway must leave the call exactly as it was, rather than with a new
-- register and stale components.
-- ---------------------------------------------------------------------------

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into firms (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Test Fund Administrators');

insert into clients (id, firm_id, name)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'Illustrative Fund II, L.P.');

insert into calls (id, client_id, call_no, fund_name)
values ('55555555-5555-5555-5555-555555555555',
        '22222222-2222-2222-2222-222222222222', 2, 'Illustrative Fund II, L.P.');


-- --- A first save creates investors, register, components and offsets ------

select lives_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555',
    '{"call_date": "2026-09-30", "payment_due_date": "2026-10-14",
      "rounding_plug_lp_id": "LP04", "fee_exempt_lp_ids": ["GP01"]}'::jsonb,
    '{"setup": "excel", "lps": "excel", "components": "excel"}'::jsonb,
    '[{"lp_id": "LP01", "lp_name": "Alpha Pension Trust", "lp_type": "LP",
       "contact_email": "treasury@alphapension.example",
       "commitment": 10000000, "opening_ucc": 8000000, "opening_paid_in": 2000000, "position": 0},
      {"lp_id": "GP01", "lp_name": "Fund GP LLC", "lp_type": "GP",
       "commitment": 500000, "opening_ucc": 450000, "opening_paid_in": 50000,
       "fee_exempt": true, "position": 1}]'::jsonb,
    '[{"component_id": "C1", "component_name": "Deal X", "category": "Deal",
       "total_amount": 3000000, "allocation_basis": "Commitment",
       "reduces_unfunded": true, "position": 0}]'::jsonb,
    '[{"offset_id": "O1", "description": "GP transaction fee offset",
       "amount": 50000, "allocation_method": "Pro-rata to gross fee", "position": 0}]'::jsonb,
    '[]'::jsonb,
    '[{"lp_id": "LP01", "figures": {"Total_Call": 1393719.91}, "position": 0}]'::jsonb
  );
$$, 'a full save succeeds');

select is((select count(*) from investors where client_id = '22222222-2222-2222-2222-222222222222'),
          2::bigint, 'investors are created from the register');

select is((select count(*) from call_register where call_id = '55555555-5555-5555-5555-555555555555'),
          2::bigint, 'register rows are written');

select is((select r.commitment::numeric from call_register r
             join investors i on i.id = r.investor_id
            where r.call_id = '55555555-5555-5555-5555-555555555555'
              and i.lp_id = 'LP01'),
          10000000::numeric, 'balances land on the right investor');

select is((select fee_exempt_lp_ids from calls where id = '55555555-5555-5555-5555-555555555555'),
          array['GP01'], 'fee-exempt list is stored as text[]');

select is((select source_lps from calls where id = '55555555-5555-5555-5555-555555555555'),
          'excel', 'per-step provenance is recorded');

select is((select count(*) from call_expected_output where call_id = '55555555-5555-5555-5555-555555555555'),
          1::bigint, 'the Expected_Output fixture is stored');


-- --- Re-saving replaces rows but keeps investor identity -------------------

select lives_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555',
    '{}'::jsonb, '{"lps": "manual"}'::jsonb,
    '[{"lp_id": "LP01", "lp_name": "Alpha Pension Trust (renamed)", "lp_type": "LP",
       "commitment": 12000000, "opening_ucc": 9000000, "position": 0}]'::jsonb,
    null, null, null, null
  );
$$, 'a partial save succeeds');

select is((select count(*) from call_register where call_id = '55555555-5555-5555-5555-555555555555'),
          1::bigint, 'the register is replaced, not appended to');

select is((select count(*) from call_components where call_id = '55555555-5555-5555-5555-555555555555'),
          1::bigint, 'passing null for a table leaves it untouched');

select is((select lp_name from investors
            where client_id = '22222222-2222-2222-2222-222222222222'
              and lp_id = 'LP01'),
          'Alpha Pension Trust (renamed)',
          'investor identity is updated in place rather than duplicated');


-- --- Atomicity -------------------------------------------------------------
-- Two Expected_Output rows for the same investor violate a unique key, and
-- that insert runs *after* the register has been replaced. The register edit
-- must therefore be rolled back with it.

select throws_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555',
    '{}'::jsonb, '{}'::jsonb,
    '[{"lp_id": "LP01", "lp_name": "Should not persist", "commitment": 1, "position": 0}]'::jsonb,
    null, null, null,
    '[{"lp_id": "LP01", "figures": {}, "position": 0},
      {"lp_id": "LP01", "figures": {}, "position": 1}]'::jsonb
  );
$$, '23505', null, 'a duplicate fixture row rejects the whole save');

select is((select r.commitment::numeric from call_register r
             join investors i on i.id = r.investor_id
            where r.call_id = '55555555-5555-5555-5555-555555555555'
              and i.lp_id = 'LP01'),
          12000000::numeric,
          'the failed save left the register untouched');


-- --- Business validation belongs to the engine, not the schema ------------

select lives_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555',
    '{}'::jsonb, '{}'::jsonb, null,
    '[{"component_id": "C1", "component_name": "Odd basis",
       "total_amount": 1, "allocation_basis": "Vibes", "position": 0}]'::jsonb,
    null, null, null
  );
$$, 'an unrecognised allocation basis is stored, for the engine to warn about');

select is((select allocation_basis from call_components
            where call_id = '55555555-5555-5555-5555-555555555555'),
          'Vibes', 'and it is kept exactly as the accountant typed it');


-- --- Still refused once the call is issued ---------------------------------

update calls set locked_at = now() where id = '55555555-5555-5555-5555-555555555555';

select throws_ok($$
  select save_call_inputs(
    '55555555-5555-5555-5555-555555555555',
    '{}'::jsonb, '{}'::jsonb,
    '[{"lp_id": "LP01", "lp_name": "After issue", "commitment": 1, "position": 0}]'::jsonb,
    null, null, null, null
  );
$$, '23001', null, 'the save function cannot edit an issued call');


select * from finish();

rollback;
