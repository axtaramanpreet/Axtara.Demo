-- ---------------------------------------------------------------------------
-- UNDO for 20260925110000_client_above_fund.sql
-- ---------------------------------------------------------------------------
-- NOT a migration: it lives outside supabase/migrations so nothing runs it by
-- accident. Run by hand only if the rename has to be taken back out of a
-- database, together with redeploying the app from before the rename:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20260925110000_client_above_fund.down.sql
--   npx supabase migration repair --status reverted 20260925110000
--
-- The exact reverse, in the reverse order: the top level gives back the name
-- `clients` before the lower level can take it again. The helpers, policies and
-- save function are restated as they stood just before the rename
-- (save_call_inputs from 20260925100000_save_every_setup_field).
-- Like the forward rename, it moves no data.
-- ---------------------------------------------------------------------------

begin;

drop policy clients_read        on clients;
drop policy client_members_read on client_members;
drop policy funds_read          on funds;
drop policy funds_insert        on funds;
drop policy funds_update        on funds;
drop policy funds_delete        on funds;
drop policy investors_read      on investors;
drop policy investors_write     on investors;
drop policy calls_read          on calls;
drop policy calls_write         on calls;
drop policy audit_log_read      on audit_log;

drop function auth_can_write_fund(uuid);
drop function auth_can_write_client(uuid);
drop function auth_fund_ids();
drop function auth_client_ids();


-- --- 2 reversed: clients → firms -------------------------------------------

alter table audit_log rename constraint audit_log_client_id_fkey to audit_log_firm_id_fkey;
alter table audit_log rename column client_id to firm_id;

alter index client_members_user_idx rename to firm_members_user_idx;
alter table client_members rename constraint client_members_role_check     to firm_members_role_check;
alter table client_members rename constraint client_members_user_id_fkey   to firm_members_user_id_fkey;
alter table client_members rename constraint client_members_client_id_fkey to firm_members_firm_id_fkey;
alter table client_members rename constraint client_members_pkey           to firm_members_pkey;
alter table client_members rename column client_id to firm_id;
alter table client_members rename to firm_members;

alter table funds rename constraint funds_client_id_fkey to clients_firm_id_fkey;
alter table funds rename column client_id to firm_id;

alter table clients rename constraint clients_name_check to firms_name_check;
alter table clients rename constraint clients_pkey       to firms_pkey;
alter table clients rename to firms;


-- --- 1 reversed: funds → clients -------------------------------------------

alter view fund_positions rename column fund_id to client_id;
alter view fund_positions rename to client_positions;

alter view call_stages rename column fund_id to client_id;

alter index audit_log_fund_idx rename to audit_log_client_idx;
alter table audit_log rename constraint audit_log_fund_id_fkey to audit_log_client_id_fkey;
alter table audit_log rename column fund_id to client_id;

alter index calls_fund_idx rename to calls_client_idx;
alter table calls rename constraint calls_fund_id_call_no_key to calls_client_id_call_no_key;
alter table calls rename constraint calls_fund_id_fkey        to calls_client_id_fkey;
alter table calls rename column fund_id to client_id;

alter index investors_fund_idx rename to investors_client_idx;
alter table investors rename constraint investors_fund_id_lp_id_key to investors_client_id_lp_id_key;
alter table investors rename constraint investors_fund_id_fkey      to investors_client_id_fkey;
alter table investors rename column fund_id to client_id;

alter trigger funds_updated_at on funds rename to clients_updated_at;
alter index funds_client_idx rename to clients_firm_idx;
alter table funds rename constraint funds_name_check to clients_name_check;
alter table funds rename constraint funds_pkey       to clients_pkey;
alter table funds rename to clients;


-- --- The helpers and policies as they were ---------------------------------

create or replace function auth_firm_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select firm_id from firm_members where user_id = auth.uid();
$$;
create or replace function auth_client_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select c.id
    from clients c
   where c.firm_id in (select auth_firm_ids());
$$;
create or replace function auth_call_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select k.id
    from calls k
   where k.client_id in (select auth_client_ids());
$$;
create or replace function auth_can_write_firm(target_firm uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from firm_members m
     where m.user_id = auth.uid()
       and m.firm_id = target_firm
       and m.role in ('owner', 'admin', 'preparer')
  );
$$;
create or replace function auth_can_write_client(target_client uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth_can_write_firm((select firm_id from clients where id = target_client));
$$;
create or replace function auth_can_write_call(target_call uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth_can_write_client((select client_id from calls where id = target_call));
$$;

create policy firms_read on firms
  for select to authenticated
  using (id in (select auth_firm_ids()));

create policy firm_members_read on firm_members
  for select to authenticated
  using (firm_id in (select auth_firm_ids()));

create policy clients_read on clients
  for select to authenticated
  using (firm_id in (select auth_firm_ids()));

create policy clients_insert on clients
  for insert to authenticated
  with check (auth_can_write_firm(firm_id));

create policy clients_update on clients
  for update to authenticated
  using (auth_can_write_firm(firm_id))
  with check (auth_can_write_firm(firm_id));

create policy clients_delete on clients
  for delete to authenticated
  using (auth_can_write_firm(firm_id));

create policy investors_read on investors
  for select to authenticated
  using (client_id in (select auth_client_ids()));

create policy investors_write on investors
  for all to authenticated
  using (auth_can_write_client(client_id))
  with check (auth_can_write_client(client_id));

create policy calls_read on calls
  for select to authenticated
  using (client_id in (select auth_client_ids()));

create policy calls_write on calls
  for all to authenticated
  using (auth_can_write_client(client_id))
  with check (auth_can_write_client(client_id));

create policy audit_log_read on audit_log
  for select to authenticated
  using (firm_id in (select auth_firm_ids()));


-- --- save_call_inputs as it was --------------------------------------------

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


notify pgrst, 'reload schema';

commit;
