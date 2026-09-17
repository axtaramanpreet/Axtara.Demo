-- ---------------------------------------------------------------------------
-- Atomic save of a capital call's inputs
-- ---------------------------------------------------------------------------
-- Saving a call replaces its register, components, offsets, transfers and
-- expected-output rows. Over PostgREST each of those would be a separate
-- request, so a failure partway through would leave the call with a new
-- register and no components — inputs that compute cleanly and are wrong.
--
-- A function is a single transaction, so the call either takes every change or
-- none of them.
--
-- Deliberately SECURITY INVOKER (the default): every statement inside is
-- subject to the caller's row-level security and to the locked-call triggers,
-- so this is a convenience for atomicity, not a way around the rules.
-- ---------------------------------------------------------------------------

create or replace function save_call_inputs(
  p_call_id     uuid,
  p_call        jsonb,
  p_sources     jsonb,
  p_lps         jsonb,
  p_components  jsonb,
  p_offsets     jsonb,
  p_transfers   jsonb,
  p_expected    jsonb
)
returns void
language plpgsql
as $$
declare
  v_client uuid;
begin
  select client_id into v_client from calls where id = p_call_id;
  if v_client is null then
    raise exception 'Capital call % not found, or not visible to you.', p_call_id
      using errcode = 'no_data_found';
  end if;

  -- Fund_Setup and Management_Fee columns. Absent keys keep their value, so a
  -- caller can save one step of the stepper without resending the rest.
  update calls set
    fund_name                    = coalesce(p_call ->> 'fund_name', fund_name),
    reporting_currency           = coalesce(p_call ->> 'reporting_currency', reporting_currency),
    call_date                    = coalesce((p_call ->> 'call_date')::date, call_date),
    payment_due_date             = coalesce((p_call ->> 'payment_due_date')::date, payment_due_date),
    default_mgmt_fee_rate_annual = coalesce((p_call ->> 'default_mgmt_fee_rate_annual')::numeric, default_mgmt_fee_rate_annual),
    default_mgmt_fee_basis       = coalesce(p_call ->> 'default_mgmt_fee_basis', default_mgmt_fee_basis),
    mgmt_fee_period_fraction     = coalesce((p_call ->> 'mgmt_fee_period_fraction')::numeric, mgmt_fee_period_fraction),
    org_expense_cap              = coalesce((p_call ->> 'org_expense_cap')::numeric, org_expense_cap),
    rounding_decimals            = coalesce((p_call ->> 'rounding_decimals')::smallint, rounding_decimals),
    rounding_plug_lp_id          = coalesce(p_call ->> 'rounding_plug_lp_id', rounding_plug_lp_id),
    fee_basis                    = coalesce(p_call ->> 'fee_basis', fee_basis),
    fee_default_rate_annual      = coalesce((p_call ->> 'fee_default_rate_annual')::numeric, fee_default_rate_annual),
    fee_period_fraction          = coalesce((p_call ->> 'fee_period_fraction')::numeric, fee_period_fraction),
    fee_reduces_unfunded         = coalesce((p_call ->> 'fee_reduces_unfunded')::boolean, fee_reduces_unfunded),
    fee_exempt_lp_ids            = coalesce(
                                     (select array_agg(value::text)
                                        from jsonb_array_elements_text(p_call -> 'fee_exempt_lp_ids') as value),
                                     fee_exempt_lp_ids),
    source_setup                 = coalesce(p_sources ->> 'setup', source_setup),
    source_lps                   = coalesce(p_sources ->> 'lps', source_lps),
    source_components            = coalesce(p_sources ->> 'components', source_components),
    source_fee                   = coalesce(p_sources ->> 'fee', source_fee),
    source_transfers             = coalesce(p_sources ->> 'transfers', source_transfers),
    source_file_name             = coalesce(p_call ->> 'source_file_name', source_file_name),
    source_file_path             = coalesce(p_call ->> 'source_file_path', source_file_path)
  where id = p_call_id;

  -- --- Register -----------------------------------------------------------
  -- Investor identity is shared across calls, so it is upserted rather than
  -- replaced: editing a name or email on call 7 updates the investor, while
  -- the balances below belong to this call alone.
  if p_lps is not null then
    insert into investors (client_id, lp_id, lp_name, lp_type, contact_email, side_letter_ref, notes)
    select v_client, x.lp_id,
           coalesce(nullif(x.lp_name, ''), x.lp_id),
           coalesce(nullif(x.lp_type, ''), 'LP'),
           nullif(x.contact_email, ''),
           nullif(x.side_letter_ref, ''),
           nullif(x.notes, '')
      from jsonb_to_recordset(p_lps) as x(
             lp_id text, lp_name text, lp_type text,
             contact_email text, side_letter_ref text, notes text)
     where coalesce(x.lp_id, '') <> ''
        on conflict (client_id, lp_id) do update
       set lp_name         = excluded.lp_name,
           lp_type         = excluded.lp_type,
           contact_email   = excluded.contact_email,
           side_letter_ref = excluded.side_letter_ref,
           notes           = excluded.notes;

    delete from call_register where call_id = p_call_id;

    insert into call_register (
      call_id, investor_id, commitment, opening_paid_in, opening_ucc,
      opening_invested_capital, mgmt_fee_rate_override, fee_exempt, status, position)
    select p_call_id, i.id,
           coalesce(x.commitment, 0),
           coalesce(x.opening_paid_in, 0),
           coalesce(x.opening_ucc, 0),
           coalesce(x.opening_invested_capital, 0),
           x.mgmt_fee_rate_override,
           coalesce(x.fee_exempt, false),
           coalesce(nullif(x.status, ''), 'Active'),
           coalesce(x.position, 0)
      from jsonb_to_recordset(p_lps) as x(
             lp_id text, commitment numeric, opening_paid_in numeric,
             opening_ucc numeric, opening_invested_capital numeric,
             mgmt_fee_rate_override numeric, fee_exempt boolean,
             status text, position integer)
      join investors i on i.client_id = v_client and i.lp_id = x.lp_id
     where coalesce(x.lp_id, '') <> '';
  end if;

  -- --- Components ---------------------------------------------------------
  if p_components is not null then
    delete from call_components where call_id = p_call_id;

    insert into call_components (
      call_id, component_id, component_name, category, total_amount,
      allocation_basis, reduces_unfunded, excused_lp_ids, notes, position)
    select p_call_id, x.component_id,
           coalesce(nullif(x.component_name, ''), x.component_id),
           nullif(x.category, ''),
           coalesce(x.total_amount, 0),
           coalesce(nullif(x.allocation_basis, ''), 'Commitment'),
           coalesce(x.reduces_unfunded, true),
           coalesce(x.excused_lp_ids, '{}'),
           nullif(x.notes, ''),
           coalesce(x.position, 0)
      from jsonb_to_recordset(p_components) as x(
             component_id text, component_name text, category text,
             total_amount numeric, allocation_basis text, reduces_unfunded boolean,
             excused_lp_ids text[], notes text, position integer)
     where coalesce(x.component_id, '') <> '';
  end if;

  -- --- Fee offsets --------------------------------------------------------
  if p_offsets is not null then
    delete from call_fee_offsets where call_id = p_call_id;

    insert into call_fee_offsets (call_id, offset_id, description, amount, allocation_method, position)
    select p_call_id, x.offset_id, nullif(x.description, ''),
           coalesce(x.amount, 0),
           coalesce(nullif(x.allocation_method, ''), 'Pro-rata to gross fee'),
           coalesce(x.position, 0)
      from jsonb_to_recordset(p_offsets) as x(
             offset_id text, description text, amount numeric,
             allocation_method text, position integer)
     where coalesce(x.offset_id, '') <> '';
  end if;

  -- --- Transfers ----------------------------------------------------------
  if p_transfers is not null then
    delete from call_transfers where call_id = p_call_id;

    insert into call_transfers (
      call_id, transfer_id, effective_date, from_lp_id, to_lp_id, to_lp_name_if_new,
      transfer_type, transfer_pct, transfers_commitment, transfers_paid_in,
      transfers_ucc, notes, position)
    select p_call_id, x.transfer_id, x.effective_date,
           nullif(x.from_lp_id, ''), nullif(x.to_lp_id, ''), nullif(x.to_lp_name_if_new, ''),
           coalesce(nullif(x.transfer_type, ''), 'Partial'),
           x.transfer_pct,
           coalesce(x.transfers_commitment, false),
           coalesce(x.transfers_paid_in, false),
           coalesce(x.transfers_ucc, false),
           nullif(x.notes, ''),
           coalesce(x.position, 0)
      from jsonb_to_recordset(p_transfers) as x(
             transfer_id text, effective_date date, from_lp_id text, to_lp_id text,
             to_lp_name_if_new text, transfer_type text, transfer_pct numeric,
             transfers_commitment boolean, transfers_paid_in boolean,
             transfers_ucc boolean, notes text, position integer)
     where coalesce(x.transfer_id, '') <> '';
  end if;

  -- --- Expected_Output fixture --------------------------------------------
  if p_expected is not null then
    delete from call_expected_output where call_id = p_call_id;

    insert into call_expected_output (call_id, lp_id, figures, position)
    select p_call_id, x.lp_id, coalesce(x.figures, '{}'::jsonb), coalesce(x.position, 0)
      from jsonb_to_recordset(p_expected) as x(lp_id text, figures jsonb, position integer)
     where coalesce(x.lp_id, '') <> '';
  end if;
end;
$$;

comment on function save_call_inputs is
  'Replaces a capital call''s inputs in one transaction. Runs as the caller, so '
  'row-level security and the locked-call triggers still apply.';
