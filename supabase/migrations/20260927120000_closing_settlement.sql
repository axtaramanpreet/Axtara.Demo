-- ---------------------------------------------------------------------------
-- Settling a later closing's equalization
-- ---------------------------------------------------------------------------
-- A later closing works out what each late investor pays and what each earlier
-- investor gets back (the equalization, frozen in closing_results). The fund
-- then settles it one of two ways, chosen per closing:
--
--   on_closing  a statement to each investor now: pay this, or receive this.
--   next_call   the next capital call carries it: a late investor's call is
--               higher, an earlier investor's lower.
--
-- Null is "not chosen yet" — every closing finalised before this existed.
--
-- The balances do not depend on the choice: an investor's paid-in and unfunded
-- move on the closing date either way. The choice is which document asks for
-- the cash, so it can still be made, or changed, after the closing is
-- finalised — until a call carrying it is sent. After that it is fixed.
--
-- A call carries it as its equalization schedule, like its fee schedule: each
-- closing it settles, and each investor's amount (+ pays, − is credited).
--
--   [{"closingId": "…", "closingNo": 2, "closingDate": "2022-05-02",
--     "byLp": {"LP03": 67032.97, "LP_01": -22344.32, "LP_02": -44688.65}}]
--
-- On calls, so a sent call's schedule is frozen with the rest of it by
-- calls_locked, and what it settled is read back from it.
-- ---------------------------------------------------------------------------

alter table closings
  add column settlement text
    check (settlement is null or settlement in ('on_closing', 'next_call'));

comment on column closings.settlement is
  'How the equalization is settled: on_closing (statements now) or next_call (on the next capital call). Null: not chosen.';

alter table calls
  add column equalization_schedule jsonb
    check (equalization_schedule is null or jsonb_typeof(equalization_schedule) = 'array');

comment on column calls.equalization_schedule is
  'The later closings whose equalization this call settles, and each investor''s amount (+ pays, − credited). Null: none.';

-- A finalised closing stays as it was, except for how it is settled — and that
-- only until a sent call has settled it.
create or replace function reject_finalised_closing_change()
returns trigger
language plpgsql
as $$
begin
  if old.finalised_at is not null then
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'settlement') = (to_jsonb(old) - 'settlement')
       and new.settlement is not null then
      if exists (
        select 1 from calls c
         where c.fund_id = old.fund_id
           and c.locked_at is not null
           and c.equalization_schedule @> jsonb_build_array(jsonb_build_object('closingId', old.id::text))
      ) then
        raise exception 'Closing %''s equalization was settled on a capital call that has been sent; how it is settled cannot change.',
          old.closing_no
          using errcode = 'restrict_violation';
      end if;
      return new;
    end if;
    raise exception 'Closing % was finalised on %; it cannot be changed. Record a new closing instead.',
      old.closing_no, old.finalised_at
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

-- Finalising records the choice with it, when one is made.
drop function finalise_closing(uuid, jsonb, text, uuid);

create or replace function finalise_closing(
  p_closing_id uuid,
  p_result jsonb,
  p_engine_version text,
  p_user uuid,
  p_settlement text
)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from closings where id = p_closing_id and finalised_at is not null) then
    raise exception 'That closing is already finalised.' using errcode = 'restrict_violation';
  end if;
  if p_result is not null then
    insert into closing_results (closing_id, engine_version, result, created_by)
    values (p_closing_id, p_engine_version, p_result, p_user);
  end if;
  update closings
     set finalised_at = now(), finalised_by = p_user, settlement = p_settlement
   where id = p_closing_id;
end;
$$;

revoke execute on function finalise_closing(uuid, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function finalise_closing(uuid, jsonb, text, uuid, text) to service_role;

-- Saving a call's inputs keeps its equalization schedule too.
CREATE OR REPLACE FUNCTION public.save_call_inputs(p_call_id uuid, p_call jsonb, p_sources jsonb, p_lps jsonb, p_components jsonb, p_offsets jsonb, p_transfers jsonb, p_expected jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_fund uuid;
begin
  select fund_id into v_fund from calls where id = p_call_id;
  if v_fund is null then
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
    charge_mgmt_fee              = coalesce((p_call ->> 'charge_mgmt_fee')::boolean, charge_mgmt_fee),
    fee_schedule                 = case when p_call ? 'fee_schedule' then nullif(p_call -> 'fee_schedule', 'null'::jsonb) else fee_schedule end,
    equalization_schedule        = case when p_call ? 'equalization_schedule' then nullif(p_call -> 'equalization_schedule', 'null'::jsonb) else equalization_schedule end,
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
  -- Investor identity is shared across calls and lives on the Investors page.
  -- A call adds any investor the fund does not know yet, and a detail typed on
  -- the call updates the investor — but a blank on the call is only a blank in
  -- this copy of the register, never an instruction to clear the investor's
  -- profile. Clearing a detail is done on the Investors page.
  if p_lps is not null then
    insert into investors (fund_id, lp_id, lp_name, lp_type, contact_email, side_letter_ref, notes)
    select v_fund, x.lp_id,
           coalesce(nullif(x.lp_name, ''), x.lp_id),
           coalesce(nullif(x.lp_type, ''), 'LP'),
           nullif(x.contact_email, ''),
           nullif(x.side_letter_ref, ''),
           nullif(x.notes, '')
      from jsonb_to_recordset(p_lps) as x(
             lp_id text, lp_name text, lp_type text,
             contact_email text, side_letter_ref text, notes text)
     where coalesce(x.lp_id, '') <> ''
        on conflict (fund_id, lp_id) do nothing;

    update investors i
       set lp_name         = coalesce(nullif(x.lp_name, ''), i.lp_name),
           lp_type         = coalesce(nullif(x.lp_type, ''), i.lp_type),
           contact_email   = coalesce(nullif(x.contact_email, ''), i.contact_email),
           side_letter_ref = coalesce(nullif(x.side_letter_ref, ''), i.side_letter_ref),
           notes           = coalesce(nullif(x.notes, ''), i.notes)
      from jsonb_to_recordset(p_lps) as x(
             lp_id text, lp_name text, lp_type text,
             contact_email text, side_letter_ref text, notes text)
     where i.fund_id = v_fund and i.lp_id = x.lp_id;

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
      join investors i on i.fund_id = v_fund and i.lp_id = x.lp_id
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
$function$;
