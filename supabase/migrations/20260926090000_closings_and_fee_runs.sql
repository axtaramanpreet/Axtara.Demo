-- ---------------------------------------------------------------------------
-- Closings, equalization and fee runs
-- ---------------------------------------------------------------------------
-- A fund admits investors at closings: a first close, then later ones. Each
-- closing records who committed what, and a later closing's equalization — the
-- late investors' catch-up, interest and missed fee, and the refunds to those
-- who paid first — is worked out by the engine and frozen when the closing is
-- finalised, as a sent capital call is.
--
-- Fee runs are the management fee as its own event: a period, the fee per
-- investor, and how it was reached. A run is frozen when recorded; re-running
-- a period after something changes records a new version beside it, with the
-- true-up against the one before. Nothing is edited.
--
-- The same division of authority as notices. A draft closing and its
-- commitments are the accountant's to type, row-level security applies. The
-- act that fixes figures — finalising a closing, recording a fee run — is the
-- server's alone: the browser has no policy to write results, and no privilege
-- to set a closing's finalised_at.
--
-- Also here: payment instructions on fund terms, the one thing a notice was
-- still missing. These are bank details: stored in the clear in this version,
-- and to be column-encrypted (Always Encrypted) in the .NET rebuild.
-- ---------------------------------------------------------------------------


-- --- Closings ----------------------------------------------------------------

create table closings (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references funds (id) on delete cascade,
  closing_no      integer not null check (closing_no > 0),
  closing_date    date not null,
  note            text,
  -- Set by the server when the closing is finalised; nothing changes after.
  finalised_at    timestamptz,
  finalised_by    uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) default auth.uid(),
  unique (fund_id, closing_no)
);

create index closings_fund_idx on closings (fund_id, closing_date);

create table closing_commitments (
  id                 uuid primary key default gen_random_uuid(),
  closing_id         uuid not null references closings (id) on delete cascade,
  investor_id        uuid not null references investors (id) on delete restrict,
  amount             money_amount not null check (amount > 0),
  -- A side letter's rate, or an exemption, for this investor's commitment.
  fee_rate_override  rate_fraction,
  fee_exempt         boolean not null default false,
  position           integer not null default 0,
  unique (closing_id, investor_id)
);

create index closing_commitments_closing_idx on closing_commitments (closing_id, position);

-- The equalization, as it stood when the closing was finalised.
create table closing_results (
  id              uuid primary key default gen_random_uuid(),
  closing_id      uuid not null unique references closings (id) on delete cascade,
  engine_version  text not null,
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id)
);


-- --- Fee runs ----------------------------------------------------------------

create table fee_runs (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references funds (id) on delete cascade,
  period_from     date not null,
  period_to       date not null check (period_to >= period_from),
  version         integer not null default 1 check (version > 0),
  -- The fee per investor and how it was reached.
  result          jsonb not null,
  -- Against the previous version of the same period, when there is one.
  true_up         jsonb,
  engine_version  text not null,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id),
  unique (fund_id, period_from, period_to, version)
);

create index fee_runs_fund_idx on fee_runs (fund_id, period_from desc, version desc);


-- --- Payment instructions on fund terms --------------------------------------

alter table fund_terms
  add column payment_bank_name     text,
  add column payment_account_name  text,
  add column payment_account_no    text,
  add column payment_swift         text,
  add column payment_routing       text,
  add column payment_reference     text;

comment on column fund_terms.payment_reference is
  'What investors quote on the wire. {LP_ID} and {CALL_NO} are filled in per notice; an equalization statement fills {CALL_NO} with EQ and the closing number.';


-- --- What cannot change once fixed -------------------------------------------

-- A finalised closing, and what it admitted, stay as they were.
create or replace function reject_finalised_closing_change()
returns trigger
language plpgsql
as $$
begin
  if old.finalised_at is not null then
    raise exception 'Closing % was finalised on %; it cannot be changed. Record a new closing instead.',
      old.closing_no, old.finalised_at
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger closings_finalised
  before update or delete on closings
  for each row execute function reject_finalised_closing_change();

create or replace function reject_commitment_on_finalised_closing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  done timestamptz;
begin
  select c.finalised_at into done
    from closings c
   where c.id = coalesce(new.closing_id, old.closing_id);
  -- The closing is gone (a draft deleted): its commitments go with it.
  if not found then
    return coalesce(new, old);
  end if;
  if done is not null then
    raise exception 'That closing was finalised on %; what it admitted cannot change.', done
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger closing_commitments_finalised
  before insert or update or delete on closing_commitments
  for each row execute function reject_commitment_on_finalised_closing();

-- Results are written once. Only when what they belong to is deleted do they
-- go with it: a draft closing's result never exists, so in practice that is a
-- whole fund being removed.
create or replace function reject_closing_result_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from closings where id = old.closing_id) then
    return old;
  end if;
  raise exception 'An equalization result is never edited or removed.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger closing_results_append_only
  before update or delete on closing_results
  for each row execute function reject_closing_result_change();

create or replace function reject_fee_run_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from funds where id = old.fund_id) then
    return old;
  end if;
  raise exception 'A recorded fee run is never edited or removed. Re-run the period to record a new version.'
    using errcode = 'restrict_violation';
end;
$$;

create trigger fee_runs_append_only
  before update or delete on fee_runs
  for each row execute function reject_fee_run_change();


-- --- Who may see and do what -------------------------------------------------

alter table closings            enable row level security;
alter table closing_commitments enable row level security;
alter table closing_results     enable row level security;
alter table fee_runs            enable row level security;

create policy closings_read on closings
  for select to authenticated
  using (fund_id in (select auth_fund_ids()));

create policy closings_write on closings
  for all to authenticated
  using (auth_can_write_fund(fund_id))
  with check (auth_can_write_fund(fund_id));

-- Finalising is the server's act. A browser may create and edit a draft, but
-- not mark it finalised, whatever the row policy allows.
revoke update on closings from authenticated;
grant update (closing_date, note) on closings to authenticated;
revoke insert on closings from authenticated;
grant insert (id, fund_id, closing_no, closing_date, note) on closings to authenticated;

create policy closing_commitments_read on closing_commitments
  for select to authenticated
  using (closing_id in (select c.id from closings c where c.fund_id in (select auth_fund_ids())));

create policy closing_commitments_write on closing_commitments
  for all to authenticated
  using (auth_can_write_fund((select c.fund_id from closings c where c.id = closing_id)))
  with check (auth_can_write_fund((select c.fund_id from closings c where c.id = closing_id)));

-- Read-only from the browser: no insert, update or delete policy at all.
create policy closing_results_read on closing_results
  for select to authenticated
  using (closing_id in (select c.id from closings c where c.fund_id in (select auth_fund_ids())));

create policy fee_runs_read on fee_runs
  for select to authenticated
  using (fund_id in (select auth_fund_ids()));


-- --- Saving a draft closing's investors, all at once --------------------------
-- Investors are upserted by LP_ID (a new investor at this close is created; an
-- existing one keeps its identity), then this closing's commitments are
-- replaced. One transaction, so a failure cannot leave a closing with half its
-- investors. Runs as the caller: row-level security and the finalised-closing
-- trigger still apply.

create or replace function save_closing_commitments(p_closing_id uuid, p_rows jsonb)
returns void
language plpgsql
as $$
declare
  v_fund uuid;
begin
  select fund_id into v_fund from closings where id = p_closing_id;
  if v_fund is null then
    raise exception 'Closing % not found, or not visible to you.', p_closing_id
      using errcode = 'no_data_found';
  end if;

  insert into investors (fund_id, lp_id, lp_name, lp_type, contact_email)
  select v_fund, x.lp_id,
         coalesce(nullif(x.lp_name, ''), x.lp_id),
         coalesce(nullif(x.lp_type, ''), 'LP'),
         nullif(x.contact_email, '')
    from jsonb_to_recordset(p_rows) as x(lp_id text, lp_name text, lp_type text, contact_email text)
   where coalesce(x.lp_id, '') <> ''
      on conflict (fund_id, lp_id) do update
     set lp_name       = excluded.lp_name,
         lp_type       = excluded.lp_type,
         contact_email = coalesce(excluded.contact_email, investors.contact_email);

  delete from closing_commitments where closing_id = p_closing_id;

  insert into closing_commitments (closing_id, investor_id, amount, fee_rate_override, fee_exempt, position)
  select p_closing_id, i.id, x.amount, x.fee_rate_override, coalesce(x.fee_exempt, false), coalesce(x.position, 0)
    from jsonb_to_recordset(p_rows) as x(lp_id text, amount numeric, fee_rate_override numeric, fee_exempt boolean, position integer)
    join investors i on i.fund_id = v_fund and i.lp_id = x.lp_id
   where coalesce(x.lp_id, '') <> '';
end;
$$;


-- --- Finalising, as one act -----------------------------------------------------
-- The equalization and the closing's finalised mark land together or not at
-- all: a result can never exist for a closing that did not finalise, nor a
-- finalised closing without its result. Only the server may call this.

create or replace function finalise_closing(
  p_closing_id uuid,
  p_result jsonb,
  p_engine_version text,
  p_user uuid
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
  update closings set finalised_at = now(), finalised_by = p_user where id = p_closing_id;
end;
$$;

revoke execute on function finalise_closing(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function finalise_closing(uuid, jsonb, text, uuid) to service_role;


notify pgrst, 'reload schema';
