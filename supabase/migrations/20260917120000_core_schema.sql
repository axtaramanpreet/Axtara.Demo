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
