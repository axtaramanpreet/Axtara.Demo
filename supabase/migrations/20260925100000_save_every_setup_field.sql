-- ---------------------------------------------------------------------------
-- Saving a call keeps what the screen says, blanks included
-- ---------------------------------------------------------------------------
-- Two faults in save_call_inputs' update of the call's own columns, both of the
-- kind that looks like it worked until the page is reloaded.
--
-- 1. GP_Name, Signatory_Name and Signatory_Title were sent by the app on every
--    save and never written. They were added to `calls` after this function,
--    and nobody added them here. So an edit on the setup screen reverted on
--    reload, and the notice kept naming whoever was set when the call was
--    created.
--
-- 2. Every column was written as coalesce(new, old), so a blank never landed.
--    Clearing the payment due date, the rounding plug or the expense cap was
--    undone on reload. The app sends null for a blanked field; for a column
--    that may be null, null is the answer, and it now sticks. An absent key
--    still means "leave it", so a partial save still works. Columns that may
--    not be null keep coalesce.
--
-- Everything else in the function is unchanged.
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

  -- Nullable columns take whatever the screen sent, blank included: a key that
  -- is present with null clears the field. A key that is absent keeps its
  -- value, so a caller can still save one step without resending the rest.
  -- Columns that cannot be null keep coalesce, since null there is not an
  -- answer anyone gave.
  update calls set
    fund_name                    = coalesce(p_call ->> 'fund_name', fund_name),
    reporting_currency           = case when p_call ? 'reporting_currency' then (p_call ->> 'reporting_currency') else reporting_currency end,
    call_date                    = case when p_call ? 'call_date' then (p_call ->> 'call_date')::date else call_date end,
    payment_due_date             = case when p_call ? 'payment_due_date' then (p_call ->> 'payment_due_date')::date else payment_due_date end,
    default_mgmt_fee_rate_annual = case when p_call ? 'default_mgmt_fee_rate_annual' then (p_call ->> 'default_mgmt_fee_rate_annual')::numeric else default_mgmt_fee_rate_annual end,
    default_mgmt_fee_basis       = case when p_call ? 'default_mgmt_fee_basis' then (p_call ->> 'default_mgmt_fee_basis') else default_mgmt_fee_basis end,
    mgmt_fee_period_fraction     = case when p_call ? 'mgmt_fee_period_fraction' then (p_call ->> 'mgmt_fee_period_fraction')::numeric else mgmt_fee_period_fraction end,
    org_expense_cap              = case when p_call ? 'org_expense_cap' then (p_call ->> 'org_expense_cap')::numeric else org_expense_cap end,
    rounding_decimals            = case when p_call ? 'rounding_decimals' then (p_call ->> 'rounding_decimals')::smallint else rounding_decimals end,
    rounding_plug_lp_id          = case when p_call ? 'rounding_plug_lp_id' then (p_call ->> 'rounding_plug_lp_id') else rounding_plug_lp_id end,
    fee_basis                    = case when p_call ? 'fee_basis' then (p_call ->> 'fee_basis') else fee_basis end,
    fee_default_rate_annual      = case when p_call ? 'fee_default_rate_annual' then (p_call ->> 'fee_default_rate_annual')::numeric else fee_default_rate_annual end,
    fee_period_fraction          = case when p_call ? 'fee_period_fraction' then (p_call ->> 'fee_period_fraction')::numeric else fee_period_fraction end,
    fee_reduces_unfunded         = coalesce((p_call ->> 'fee_reduces_unfunded')::boolean, fee_reduces_unfunded),
    fee_exempt_lp_ids            = coalesce(
                                     (select array_agg(value::text)
                                        from jsonb_array_elements_text(p_call -> 'fee_exempt_lp_ids') as value),
                                     fee_exempt_lp_ids),
    gp_name                      = case when p_call ? 'gp_name' then (p_call ->> 'gp_name') else gp_name end,
    signatory_name               = case when p_call ? 'signatory_name' then (p_call ->> 'signatory_name') else signatory_name end,
    signatory_title              = case when p_call ? 'signatory_title' then (p_call ->> 'signatory_title') else signatory_title end,
    source_setup                 = coalesce(p_sources ->> 'setup', source_setup),
    source_lps                   = coalesce(p_sources ->> 'lps', source_lps),
    source_components            = coalesce(p_sources ->> 'components', source_components),
    source_fee                   = coalesce(p_sources ->> 'fee', source_fee),
    source_transfers             = coalesce(p_sources ->> 'transfers', source_transfers),
    source_file_name             = case when p_call ? 'source_file_name' then (p_call ->> 'source_file_name') else source_file_name end,
    source_file_path             = case when p_call ? 'source_file_path' then (p_call ->> 'source_file_path') else source_file_path end
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

