-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Two boundaries are drawn here.
--
-- 1. Tenancy. A signed-in user reaches exactly the funds belonging to firms
--    they are a member of, and nothing else.
--
-- 2. Authority. Three things must never be writable from the browser, however
--    well-behaved the client is: marking a notice sent, freezing a computed
--    snapshot, and the audit log. A bug or a tampered client must not be able
--    to tell investors money is due. Those writes have no policy at all, so
--    they are refused for every signed-in user and can only be performed by
--    server-side code holding the service role — the Next.js route handlers.
-- ---------------------------------------------------------------------------


-- Firms the current user belongs to. SECURITY DEFINER so the policies can read
-- firm_members without recursing through firm_members' own policy.
create or replace function auth_firm_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select firm_id from firm_members where user_id = auth.uid();
$$;

-- Clients (funds) the current user may see.
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

-- Calls the current user may see.
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

-- True when the user may change data for this firm, as opposed to only read it.
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


alter table firms                enable row level security;
alter table firm_members         enable row level security;
alter table clients              enable row level security;
alter table investors            enable row level security;
alter table calls                enable row level security;
alter table call_register        enable row level security;
alter table call_components      enable row level security;
alter table call_fee_offsets     enable row level security;
alter table call_transfers       enable row level security;
alter table call_expected_output enable row level security;
alter table call_results         enable row level security;
alter table notices              enable row level security;
alter table audit_log            enable row level security;


-- --- Firms and membership: readable by members, managed server-side ---------

create policy firms_read on firms
  for select to authenticated
  using (id in (select auth_firm_ids()));

create policy firm_members_read on firm_members
  for select to authenticated
  using (firm_id in (select auth_firm_ids()));


-- --- Clients ---------------------------------------------------------------

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


-- --- Investors -------------------------------------------------------------

create policy investors_read on investors
  for select to authenticated
  using (client_id in (select auth_client_ids()));

create policy investors_write on investors
  for all to authenticated
  using (auth_can_write_client(client_id))
  with check (auth_can_write_client(client_id));


-- --- Calls and their inputs ------------------------------------------------
-- Writes are additionally gated by the locked_at triggers, which refuse any
-- change to an issued call regardless of who is asking.

create policy calls_read on calls
  for select to authenticated
  using (client_id in (select auth_client_ids()));

create policy calls_write on calls
  for all to authenticated
  using (auth_can_write_client(client_id))
  with check (auth_can_write_client(client_id));

create policy call_register_read on call_register
  for select to authenticated
  using (call_id in (select auth_call_ids()));

create policy call_register_write on call_register
  for all to authenticated
  using (auth_can_write_call(call_id))
  with check (auth_can_write_call(call_id));

create policy call_components_read on call_components
  for select to authenticated
  using (call_id in (select auth_call_ids()));

create policy call_components_write on call_components
  for all to authenticated
  using (auth_can_write_call(call_id))
  with check (auth_can_write_call(call_id));

create policy call_fee_offsets_read on call_fee_offsets
  for select to authenticated
  using (call_id in (select auth_call_ids()));

create policy call_fee_offsets_write on call_fee_offsets
  for all to authenticated
  using (auth_can_write_call(call_id))
  with check (auth_can_write_call(call_id));

create policy call_transfers_read on call_transfers
  for select to authenticated
  using (call_id in (select auth_call_ids()));

create policy call_transfers_write on call_transfers
  for all to authenticated
  using (auth_can_write_call(call_id))
  with check (auth_can_write_call(call_id));

create policy call_expected_output_read on call_expected_output
  for select to authenticated
  using (call_id in (select auth_call_ids()));

create policy call_expected_output_write on call_expected_output
  for all to authenticated
  using (auth_can_write_call(call_id))
  with check (auth_can_write_call(call_id));


-- --- Snapshots and notices: read-only from the browser ---------------------
-- Note the deliberate absence of insert/update policies. Freezing a snapshot
-- and recording a notice as sent are privileged operations performed by the
-- server, so that the act of telling an investor they owe money cannot
-- originate in a browser.

create policy call_results_read on call_results
  for select to authenticated
  using (call_id in (select auth_call_ids()));

create policy notices_read on notices
  for select to authenticated
  using (call_id in (select auth_call_ids()));


-- --- Audit log: readable by the firm, written only by the server -----------

create policy audit_log_read on audit_log
  for select to authenticated
  using (firm_id in (select auth_firm_ids()));
