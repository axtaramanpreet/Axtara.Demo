-- -------------------------------------------------------------------------
-- Every migration, in order, as one script
-- -------------------------------------------------------------------------
-- GENERATED FILE — do not edit. Regenerate with
--
--   node scripts/build-combined-migrations.mjs
--
-- For the case where `supabase db push` cannot run. The CLI provisions its own
-- `cli_login_postgres` role before pushing, and on a project whose postgres
-- role lacks ADMIN on it that fails with:
--
--   permission denied to alter role
--
-- Paste this into the Supabase SQL Editor instead. It applies the same
-- migrations and then records them in supabase_migrations.schema_migrations,
-- so a later `db push` sees them as already applied rather than replaying them.
--
-- Wrapped in a transaction: if any statement fails, nothing is left half-built.
-- -------------------------------------------------------------------------

begin;

-- The CLI creates these on its first push. Nothing has pushed here yet.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);

-- =========================================================================
-- 20260917120000_core_schema.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Capital Call Engine — core schema
-- ---------------------------------------------------------------------------
-- Shape of the data follows one rule: a capital call's INPUTS are editable and
-- recomputed on demand, but once a notice goes to an investor the numbers on it
-- become a legal statement and are frozen. Everything below is arranged around
-- that split — input tables that change, and snapshot tables that never do.
--
-- Column names are the snake_case of the accountant's workbook headings
-- (LP_ID -> lp_id, Opening_UCC -> opening_ucc) so the spreadsheet, the engine
-- and the database stay one vocabulary.
--
-- Money is `numeric`, never float. The engine computes in JavaScript doubles
-- and rounds to the cent; the database stores the rounded result exactly.
-- ---------------------------------------------------------------------------

-- Amounts: 4 dp is more than the 2 the template uses, and leaves room for
-- funds that round finer. `rounding_decimals` is constrained to match.
create domain money_amount as numeric(20, 4);

-- Rates are fractions (0.02 = 2% per annum), not percentages.
create domain rate_fraction as numeric(12, 8);


-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
-- A firm is the fund administrator. Every row below belongs to exactly one
-- firm, transitively, which is what row-level security keys off.

create table firms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table firm_members (
  firm_id     uuid not null references firms (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- preparer may build and approve calls; only admin and owner may send.
  role        text not null default 'preparer'
                check (role in ('owner', 'admin', 'preparer', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (firm_id, user_id)
);

create index firm_members_user_idx on firm_members (user_id);

-- A "client" in the UI is a fund the firm administers.
create table clients (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create index clients_firm_idx on clients (firm_id);


-- ---------------------------------------------------------------------------
-- Investors
-- ---------------------------------------------------------------------------
-- Investor identity is slowly-changing and spans calls: LP01 is the same
-- investor in call 1 and call 7. Their *position* is per-call and lives in
-- call_register, because opening balances differ every call.

create table investors (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients (id) on delete cascade,
  lp_id            text not null check (length(trim(lp_id)) > 0),
  lp_name          text not null,
  lp_type          text not null default 'LP',
  contact_email    text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  side_letter_ref  text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, lp_id)
);

create index investors_client_idx on investors (client_id);


-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
-- Fund_Setup and Management_Fee are fixed, known field sets, so they are
-- columns rather than JSON: typed, constrainable, and queryable by the Home
-- view's fund-position and drawdown cards.

create table calls (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients (id) on delete cascade,
  call_no      integer not null check (call_no > 0),

  -- Fund_Setup tab
  fund_name                     text not null,
  reporting_currency            text not null default 'USD' check (reporting_currency ~ '^[A-Z]{3}$'),
  call_date                     date,
  payment_due_date              date,
  default_mgmt_fee_rate_annual  rate_fraction,
  default_mgmt_fee_basis        text default 'Commitment',
  mgmt_fee_period_fraction      rate_fraction,
  org_expense_cap               money_amount,
  rounding_decimals             smallint not null default 2
                                  check (rounding_decimals between 0 and 4),
  rounding_plug_lp_id           text,

  -- Management_Fee tab. These override the Fund_Setup defaults when set.
  fee_basis              text default 'Commitment',
  fee_default_rate_annual rate_fraction,
  fee_period_fraction    rate_fraction,
  fee_reduces_unfunded   boolean not null default true,
  fee_exempt_lp_ids      text[] not null default '{}',

  -- Where each step's inputs came from, driving the stepper's detail lines.
  source_setup       text not null default 'empty' check (source_setup in ('excel','manual','template','carried','empty')),
  source_lps         text not null default 'empty' check (source_lps in ('excel','manual','template','carried','empty')),
  source_components  text not null default 'empty' check (source_components in ('excel','manual','template','carried','empty')),
  source_fee         text not null default 'empty' check (source_fee in ('excel','manual','template','carried','empty')),
  source_transfers   text not null default 'empty' check (source_transfers in ('excel','manual','template','carried','empty')),

  -- The workbook as uploaded, kept in Storage so the original is auditable.
  source_file_name    text,
  source_file_path    text,

  prepared_by  uuid references auth.users (id),
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Set when the first notice is sent. Inputs are immutable from that moment;
  -- enforced by trigger, not by trust. See the immutability migration.
  locked_at    timestamptz,

  unique (client_id, call_no),
  constraint payment_due_on_or_after_call_date
    check (payment_due_date is null or call_date is null or payment_due_date >= call_date)
);

create index calls_client_idx on calls (client_id, call_no desc);


-- Per-call opening position for one investor (the LP_Register tab).
create table call_register (
  id                        uuid primary key default gen_random_uuid(),
  call_id                   uuid not null references calls (id) on delete cascade,
  investor_id               uuid not null references investors (id) on delete restrict,
  commitment                money_amount not null default 0,
  opening_paid_in           money_amount not null default 0,
  opening_ucc               money_amount not null default 0,
  opening_invested_capital  money_amount not null default 0,
  mgmt_fee_rate_override    rate_fraction,
  fee_exempt                boolean not null default false,
  status                    text not null default 'Active'
                              check (status in ('Active', 'Transferred', 'Defaulted')),
  -- Preserves the accountant's row order from the workbook.
  position                  integer not null default 0,
  unique (call_id, investor_id)
);

create index call_register_call_idx on call_register (call_id, position);


-- One line of the call before the management fee (the Call_Components tab).
create table call_components (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid not null references calls (id) on delete cascade,
  component_id      text not null,
  component_name    text not null,
  category          text,
  total_amount      money_amount not null default 0,
  allocation_basis  text not null default 'Commitment'
                      check (allocation_basis in ('Commitment', 'UCC', 'Invested_Capital')),
  -- Y in the workbook: does this draw down unfunded commitment?
  reduces_unfunded  boolean not null default true,
  excused_lp_ids    text[] not null default '{}',
  notes             text,
  position          integer not null default 0,
  unique (call_id, component_id)
);

create index call_components_call_idx on call_components (call_id, position);


-- Something that reduces the gross management fee (Management_Fee > Offsets).
create table call_fee_offsets (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid not null references calls (id) on delete cascade,
  offset_id          text not null,
  description        text,
  amount             money_amount not null default 0,
  allocation_method  text not null default 'Pro-rata to gross fee',
  position           integer not null default 0,
  unique (call_id, offset_id)
);

create index call_fee_offsets_call_idx on call_fee_offsets (call_id, position);


-- A secondary transfer between investors (the Transfers tab).
create table call_transfers (
  id                     uuid primary key default gen_random_uuid(),
  call_id                uuid not null references calls (id) on delete cascade,
  transfer_id            text not null,
  effective_date         date,
  from_lp_id             text,
  to_lp_id               text,
  to_lp_name_if_new      text,
  transfer_type          text not null default 'Partial'
                           check (transfer_type in ('Full', 'Partial')),
  transfer_pct           numeric(9, 8) check (transfer_pct is null or (transfer_pct > 0 and transfer_pct <= 1)),
  transfers_commitment   boolean not null default false,
  transfers_paid_in      boolean not null default false,
  transfers_ucc          boolean not null default false,
  notes                  text,
  position               integer not null default 0,
  unique (call_id, transfer_id)
);

create index call_transfers_call_idx on call_transfers (call_id, position);


-- The accountant's Expected_Output tab, when the uploaded workbook carries one.
-- Figures are JSONB because the component columns are named per fund
-- (Deal_X, Org_Exp, …) — a genuinely dynamic shape, unlike everything above.
create table call_expected_output (
  id        uuid primary key default gen_random_uuid(),
  call_id   uuid not null references calls (id) on delete cascade,
  lp_id     text not null,
  figures   jsonb not null default '{}'::jsonb,
  position  integer not null default 0,
  unique (call_id, lp_id)
);


-- ---------------------------------------------------------------------------
-- Results and notices — the frozen half
-- ---------------------------------------------------------------------------
-- A draft call is never stored computed: the engine is pure, so the app
-- recomputes from inputs on every render and cannot drift. What IS stored is a
-- snapshot taken when notices are approved and sent, because from then on the
-- numbers are what an investor was told, not what the engine would say today.

create table call_results (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null references calls (id) on delete cascade,
  -- Git SHA of the engine that produced this. If a bug is fixed later, this is
  -- how you tell what an investor was actually sent from what we'd compute now.
  engine_version  text not null,
  computed_at     timestamptz not null default now(),
  computed_by     uuid references auth.users (id),
  totals          jsonb not null,
  rows            jsonb not null,
  checks          jsonb not null default '[]'::jsonb,
  golden_diffs    jsonb not null default '[]'::jsonb
);

create index call_results_call_idx on call_results (call_id, computed_at desc);


create table notices (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid not null references calls (id) on delete cascade,
  investor_id    uuid not null references investors (id) on delete restrict,
  status         text not null default 'draft' check (status in ('draft', 'approved', 'sent')),

  approved_at    timestamptz,
  approved_by    uuid references auth.users (id),
  sent_at        timestamptz,
  sent_by        uuid references auth.users (id),
  sent_to_email  text,

  -- The notice exactly as sent, and the snapshot it was rendered from.
  -- Null while draft; written once at send and never updated.
  payload        jsonb,
  result_id      uuid references call_results (id),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (call_id, investor_id),

  -- A status must carry the evidence for itself.
  constraint approved_has_timestamp
    check (status <> 'approved' or approved_at is not null),
  constraint sent_has_evidence
    check (status <> 'sent' or (sent_at is not null and payload is not null and result_id is not null))
);

create index notices_call_idx on notices (call_id);


-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
-- Append-only. Update and delete are refused by trigger and granted to nobody.

create table audit_log (
  id           bigint generated always as identity primary key,
  firm_id      uuid references firms (id) on delete set null,
  client_id    uuid references clients (id) on delete set null,
  call_id      uuid references calls (id) on delete set null,
  actor        uuid references auth.users (id),
  action       text not null,
  entity_type  text,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);

create index audit_log_client_idx on audit_log (client_id, at desc);
create index audit_log_call_idx on audit_log (call_id, at desc);


-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger clients_updated_at   before update on clients   for each row execute function set_updated_at();
create trigger investors_updated_at before update on investors for each row execute function set_updated_at();
create trigger calls_updated_at     before update on calls     for each row execute function set_updated_at();
create trigger notices_updated_at   before update on notices   for each row execute function set_updated_at();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120000', 'core_schema')
on conflict (version) do nothing;

-- =========================================================================
-- 20260917120100_immutability.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Immutability of issued calls
-- ---------------------------------------------------------------------------
-- Once an investor has been sent a notice, the figures on it are a statement
-- about a capital obligation. Editing the inputs afterwards would silently
-- rewrite history: the app would recompute and show numbers nobody was ever
-- told. The correct remedy for a mistake in an issued call is a new call, not
-- an edit — which is also how fund accounting works on paper.
--
-- This is enforced here rather than in the application because application
-- rules are one refactor away from being bypassed, and because the service-role
-- key sidesteps row-level security entirely. Triggers do not.
-- ---------------------------------------------------------------------------


-- Lock the call the moment its first notice is sent.
create or replace function lock_call_on_first_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' then
    update calls
       set locked_at = now()
     where id = new.call_id
       and locked_at is null;
  end if;
  return null;
end;
$$;

create trigger notices_lock_call
  after insert or update of status on notices
  for each row
  execute function lock_call_on_first_send();


-- Refuse any change to a call's inputs once it is locked.
-- Generic over every input table: they all carry a `call_id`.
create or replace function reject_when_call_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_call uuid;
  locked      timestamptz;
begin
  target_call := coalesce(
    (to_jsonb(new) ->> 'call_id')::uuid,
    (to_jsonb(old) ->> 'call_id')::uuid
  );

  select c.locked_at into locked from calls c where c.id = target_call;

  if locked is not null then
    raise exception
      'Capital call % was issued on % and its inputs are immutable. Raise a new call to correct it.',
      target_call, locked
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger call_register_locked
  before insert or update or delete on call_register
  for each row execute function reject_when_call_locked();

create trigger call_components_locked
  before insert or update or delete on call_components
  for each row execute function reject_when_call_locked();

create trigger call_fee_offsets_locked
  before insert or update or delete on call_fee_offsets
  for each row execute function reject_when_call_locked();

create trigger call_transfers_locked
  before insert or update or delete on call_transfers
  for each row execute function reject_when_call_locked();

create trigger call_expected_output_locked
  before insert or update or delete on call_expected_output
  for each row execute function reject_when_call_locked();


-- A locked call itself cannot be edited or deleted.
create or replace function reject_locked_call_change()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is not null then
    raise exception
      'Capital call % was issued on % and cannot be modified or deleted.',
      old.id, old.locked_at
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger calls_locked
  before update or delete on calls
  for each row execute function reject_locked_call_change();


-- A computed snapshot is written once. It is the record of what the engine
-- produced at a moment in time; amending it would defeat the purpose.
create or replace function reject_snapshot_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'call_results rows are immutable once written (snapshot %).', old.id
    using errcode = 'restrict_violation';
end;
$$;

create trigger call_results_immutable
  before update or delete on call_results
  for each row execute function reject_snapshot_change();


-- A sent notice keeps the payload and timestamp it was sent with. Status may
-- still move (the UI offers "Mark unsent" for a mis-send), but the evidence of
-- what was sent, when, and from which snapshot does not change.
create or replace function protect_sent_notice()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'sent' then
    if new.payload is distinct from old.payload
       or new.sent_at is distinct from old.sent_at
       or new.result_id is distinct from old.result_id
       or new.sent_to_email is distinct from old.sent_to_email then
      raise exception
        'Notice % was sent on %; its payload and delivery record are immutable.',
        old.id, old.sent_at
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger notices_protect_sent
  before update on notices
  for each row execute function protect_sent_notice();


-- The audit log only ever grows.
create or replace function reject_audit_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function reject_audit_change();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120100', 'immutability')
on conflict (version) do nothing;

-- =========================================================================
-- 20260917120200_row_level_security.sql
-- =========================================================================

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120200', 'row_level_security')
on conflict (version) do nothing;

-- =========================================================================
-- 20260917120300_derived_views.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Derived views
-- ---------------------------------------------------------------------------
-- The Home screen's cards aggregate across calls, which is a database job
-- rather than something to assemble in the browser.
--
-- `security_invoker` makes each view run under the querying user's own
-- row-level security. Without it a view would read with its owner's rights and
-- quietly become a way around tenancy.
-- ---------------------------------------------------------------------------


-- The most recent computed snapshot for each call.
create view call_latest_result
with (security_invoker = on)
as
select distinct on (r.call_id)
       r.call_id,
       r.id as result_id,
       r.engine_version,
       r.computed_at,
       r.totals
  from call_results r
 order by r.call_id, r.computed_at desc;


-- Notice progress per call, and the stage the UI shows.
--
-- Stage is derived, never stored, so it cannot disagree with the notices it is
-- derived from:
--   not_started     — nothing entered yet
--   issued          — every active investor has been sent their notice
--   partially_sent  — some have
--   in_progress     — inputs exist, nothing sent
create view call_stages
with (security_invoker = on)
as
with active_investors as (
  select r.call_id, count(*) as n_active
    from call_register r
   where r.status = 'Active'
   group by r.call_id
),
notice_counts as (
  select n.call_id,
         count(*) filter (where n.status = 'sent')     as n_sent,
         count(*) filter (where n.status = 'approved') as n_approved,
         count(*) filter (where n.status = 'draft')    as n_draft
    from notices n
   group by n.call_id
),
component_counts as (
  select c.call_id, count(*) as n_components
    from call_components c
   group by c.call_id
)
select k.id as call_id,
       k.client_id,
       k.call_no,
       coalesce(a.n_active, 0)      as active_investors,
       coalesce(n.n_sent, 0)        as notices_sent,
       coalesce(n.n_approved, 0)    as notices_approved,
       coalesce(n.n_draft, 0)       as notices_draft,
       coalesce(cc.n_components, 0) as components,
       k.locked_at,
       case
         when coalesce(a.n_active, 0) = 0 and coalesce(cc.n_components, 0) = 0 then 'not_started'
         when coalesce(a.n_active, 0) > 0 and coalesce(n.n_sent, 0) >= a.n_active then 'issued'
         when coalesce(n.n_sent, 0) > 0 then 'partially_sent'
         else 'in_progress'
       end as stage
  from calls k
  left join active_investors  a  on a.call_id  = k.id
  left join notice_counts     n  on n.call_id  = k.id
  left join component_counts  cc on cc.call_id = k.id;


-- Fund position, built from issued calls only.
--
-- Draft calls are deliberately excluded: their figures are recomputed by the
-- engine on demand and never stored, so the only numbers here are ones that
-- were actually called. The Home screen overlays the call in progress on top,
-- which is why its subtitle reads "before Call No. N" rather than "after".
create view client_positions
with (security_invoker = on)
as
with latest_call as (
  select distinct on (k.client_id)
         k.client_id, k.id as call_id, k.call_no, k.payment_due_date
    from calls k
   order by k.client_id, k.call_no desc
),
commitments as (
  -- Commitments as at the most recent call's register.
  select l.client_id,
         sum(r.commitment)      as total_commitments,
         count(*)               as investors
    from latest_call l
    join call_register r on r.call_id = l.call_id
   where r.status = 'Active'
   group by l.client_id
),
issued as (
  select k.client_id,
         count(*)                                            as calls_issued,
         sum((lr.totals ->> 'total')::numeric)               as called_to_date,
         sum((lr.totals ->> 'reduces')::numeric)             as called_against_commitment
    from calls k
    join call_latest_result lr on lr.call_id = k.id
   where k.locked_at is not null
   group by k.client_id
)
select c.id as client_id,
       c.name,
       coalesce(cm.total_commitments, 0)         as total_commitments,
       coalesce(cm.investors, 0)                 as investors,
       coalesce(i.calls_issued, 0)               as calls_issued,
       coalesce(i.called_to_date, 0)             as called_to_date,
       coalesce(i.called_against_commitment, 0)  as called_against_commitment,
       coalesce(cm.total_commitments, 0) - coalesce(i.called_against_commitment, 0)
                                                 as unfunded_commitment,
       lc.call_no        as latest_call_no,
       lc.payment_due_date as next_payment_due
  from clients c
  left join commitments cm on cm.client_id = c.id
  left join issued      i  on i.client_id  = c.id
  left join latest_call lc on lc.client_id = c.id;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120300', 'derived_views')
on conflict (version) do nothing;

-- =========================================================================
-- 20260917120400_save_call_inputs.sql
-- =========================================================================

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120400', 'save_call_inputs')
on conflict (version) do nothing;

-- =========================================================================
-- 20260917120500_relax_input_validation.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Let the engine own business validation
-- ---------------------------------------------------------------------------
-- The original schema copied rules that the engine already enforces —
-- allocation basis, transfer type and percentage, investor status, due date
-- ordering — into CHECK constraints. That turned out to be wrong twice over.
--
-- Where the mapper coerced a value to satisfy the constraint, the accountant's
-- typo was silently corrected: type "Vibes" as an allocation basis, save,
-- reload, and it now reads "Commitment" with no warning that anything was
-- changed. Where it did not coerce, the save simply failed with a constraint
-- name instead of the engine's plain "Transfer_Pct must be between 0 and 1".
--
-- The division of labour is now explicit:
--
--   the database  — structure: types, keys, uniqueness, and the immutability
--                   of an issued call
--   the engine    — business rules, reported as OK/WARN/FAIL checks against
--                   inputs that are stored exactly as they were entered
--
-- Inputs are a work in progress until the call is issued. Storing them
-- faithfully, warts included, is what lets the Checks tab tell the truth.
-- ---------------------------------------------------------------------------

-- The engine defaults an unrecognised basis to Commitment and says so.
alter table call_components drop constraint call_components_allocation_basis_check;

-- The engine treats anything that is not "Full" as partial, and reports a
-- percentage outside 0–1 as a skipped transfer rather than refusing the row.
alter table call_transfers drop constraint call_transfers_transfer_type_check;
alter table call_transfers drop constraint call_transfers_transfer_pct_check;

-- The engine treats any status other than Active as not participating, which
-- covers firm-specific values like "Withdrawn" without a migration.
alter table call_register drop constraint call_register_status_check;

-- A due date is often typed before the call date it must follow. Ordering is a
-- UI concern during entry, not a reason to reject the row.
alter table calls drop constraint payment_due_on_or_after_call_date;

-- Deliberately kept:
--   calls_reporting_currency_check   — three-letter ISO code, structural
--   calls_rounding_decimals_check    — must fit money_amount's 4 dp
--   notices_status_check             — the workflow the server enforces
--   approved_has_timestamp,
--   sent_has_evidence                — a status must carry its own evidence

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120500', 'relax_input_validation')
on conflict (version) do nothing;

-- =========================================================================
-- 20260917120600_position_paid_in.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Add paid-in capital to the fund position
-- ---------------------------------------------------------------------------
-- The Home card lists "Called to date" and "Paid-in capital" as separate lines,
-- and they are separate things: called-to-date is what has been demanded across
-- issued calls, paid-in is what investors have actually contributed. The view
-- exposed only the former, so the card rendered the same number twice.
--
-- Paid-in comes from the opening balances on the most recent call's register,
-- which by construction already carry every contribution made before it. That
-- matches the card's own subtitle, "before Call No. N".
--
-- Unfunded commitment moves to the register for the same reason. Deriving it as
-- commitments minus what issued calls drew ignored every contribution made
-- before this system held the fund: a fund with 50.5m committed and 9.8m
-- already paid in reported its full 50.5m as still unfunded. The register's
-- opening_ucc is the authoritative figure, and the three lines now agree —
-- commitments less paid-in equals unfunded.
-- ---------------------------------------------------------------------------

-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW can only
-- append columns, not insert one into the middle of the list.
drop view if exists client_positions;

create view client_positions
with (security_invoker = on)
as
with latest_call as (
  select distinct on (k.client_id)
         k.client_id, k.id as call_id, k.call_no, k.payment_due_date
    from calls k
   order by k.client_id, k.call_no desc
),
register as (
  select l.client_id,
         sum(r.commitment)      as total_commitments,
         sum(r.opening_paid_in) as paid_in_capital,
         sum(r.opening_ucc)     as unfunded_commitment,
         count(*)               as investors
    from latest_call l
    join call_register r on r.call_id = l.call_id
   where r.status = 'Active'
   group by l.client_id
),
issued as (
  select k.client_id,
         count(*)                                as calls_issued,
         sum((lr.totals ->> 'total')::numeric)   as called_to_date,
         sum((lr.totals ->> 'reduces')::numeric) as called_against_commitment
    from calls k
    join call_latest_result lr on lr.call_id = k.id
   where k.locked_at is not null
   group by k.client_id
)
select c.id as client_id,
       c.name,
       coalesce(rg.total_commitments, 0)        as total_commitments,
       coalesce(rg.paid_in_capital, 0)          as paid_in_capital,
       coalesce(rg.investors, 0)                as investors,
       coalesce(i.calls_issued, 0)              as calls_issued,
       coalesce(i.called_to_date, 0)            as called_to_date,
       coalesce(i.called_against_commitment, 0) as called_against_commitment,
       coalesce(rg.unfunded_commitment, 0)      as unfunded_commitment,
       lc.call_no          as latest_call_no,
       lc.payment_due_date as next_payment_due
  from clients c
  left join register    rg on rg.client_id = c.id
  left join issued      i  on i.client_id  = c.id
  left join latest_call lc on lc.client_id = c.id;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120600', 'position_paid_in')
on conflict (version) do nothing;

-- =========================================================================
-- 20260918090000_delete_empty_client.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- Let a fund created by mistake be removed
-- ---------------------------------------------------------------------------
-- "+ New client" could add a fund but nothing could ever remove one, so a
-- typo was permanent.
--
-- This is narrower than it looks. Deleting a client cascades to its calls, and
-- call_register.investor_id is ON DELETE RESTRICT, so a fund that has ever had
-- a register refuses to go. In practice only a fund with no call history can be
-- deleted — which is exactly the mistake worth undoing — and anything with
-- investors behind it is protected by the same rule that protects issued calls.
--
-- Funds that have done business are retired with `archived_at`, not deleted.
-- ---------------------------------------------------------------------------

create policy clients_delete on clients
  for delete to authenticated
  using (auth_can_write_firm(firm_id));

insert into supabase_migrations.schema_migrations (version, name)
values ('20260918090000', 'delete_empty_client')
on conflict (version) do nothing;

commit;

-- Confirm: expect one row per migration, 8 in total.
select version, name from supabase_migrations.schema_migrations order by version;
