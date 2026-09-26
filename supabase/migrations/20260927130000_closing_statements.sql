-- ---------------------------------------------------------------------------
-- Equalization statements, sent
-- ---------------------------------------------------------------------------
-- A later closing settled "now" sends each investor whose equalization moves
-- money a statement: a late investor what to pay, an earlier one what comes
-- back. They go the way call notices do — approved, then sent — and what was
-- sent is kept exactly as it was: the statement's figures (from the frozen
-- closing_results row), who sent it, when, and where it was delivered.
--
-- Rows are written only by the server, with the service role: browsers read.
-- ---------------------------------------------------------------------------

create table closing_statements (
  id                  uuid primary key default gen_random_uuid(),
  closing_id          uuid not null references closings (id) on delete cascade,
  investor_id         uuid not null references investors (id) on delete restrict,
  status              text not null default 'draft' check (status in ('draft', 'approved', 'sent')),

  approved_at         timestamptz,
  approved_by         uuid references auth.users (id),
  sent_at             timestamptz,
  sent_by             uuid references auth.users (id),
  sent_to_email       text,

  -- The statement exactly as sent, and the frozen equalization it came from.
  payload             jsonb,
  result_id           uuid references closing_results (id),

  email_status        text check (email_status is null or email_status in ('pending', 'delivered', 'failed')),
  email_attempted_at  timestamptz,
  email_message_id    text,
  email_error         text,
  email_delivered_to  text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (closing_id, investor_id),

  constraint statement_approved_has_timestamp
    check (status <> 'approved' or approved_at is not null),
  constraint statement_sent_has_evidence
    check (status <> 'sent' or (sent_at is not null and payload is not null and result_id is not null))
);

create index closing_statements_closing_idx on closing_statements (closing_id);

comment on table closing_statements is
  'Equalization statements for a later closing settled on the closing: approved, then sent, then kept as sent.';

-- A sent statement is the record of what an investor was told to pay or would
-- receive. Only its delivery can be written after that (a retry); the rest,
-- and the row itself, stay.
create or replace function protect_sent_statement()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'sent' then
    if tg_op = 'DELETE' then
      raise exception 'Statement % was sent on %; it cannot be deleted.', old.id, old.sent_at
        using errcode = 'restrict_violation';
    end if;
    if new.status is distinct from old.status
       or new.payload is distinct from old.payload
       or new.sent_at is distinct from old.sent_at
       or new.sent_by is distinct from old.sent_by
       or new.result_id is distinct from old.result_id
       or new.sent_to_email is distinct from old.sent_to_email
       or new.closing_id is distinct from old.closing_id
       or new.investor_id is distinct from old.investor_id then
      raise exception 'Statement % was sent on %; what was sent cannot change.', old.id, old.sent_at
        using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger closing_statements_protect_sent
  before update or delete on closing_statements
  for each row execute function protect_sent_statement();

alter table closing_statements enable row level security;

create policy closing_statements_read on closing_statements
  for select to authenticated
  using (closing_id in (select c.id from closings c where c.fund_id in (select auth_fund_ids())));

revoke insert, update, delete on closing_statements from anon, authenticated;

-- How a finalised closing is settled is fixed once money has been asked for:
-- a sent call that carried it, or a sent statement.
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
      if exists (select 1 from closing_statements s where s.closing_id = old.id and s.status = 'sent') then
        raise exception 'Closing %''s equalization statements have been sent; how it is settled cannot change.',
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
