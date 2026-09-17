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
