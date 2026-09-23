-- ---------------------------------------------------------------------------
-- A sent notice stays sent
-- ---------------------------------------------------------------------------
-- `protect_sent_notice` froze what was sent — payload, sent_at, result_id,
-- sent_to_email — but let the status move, so that a mis-send could be walked
-- back. Nothing in the app ever offered that. What did happen was worse: "Approve
-- all" upserted every active investor to 'approved', including one already
-- sent. The trigger allowed it, because only the evidence was frozen, and from
-- then on the row was no longer 'sent', so the evidence was no longer protected
-- either. The next send overwrote the payload, the timestamp and the snapshot it
-- pointed to, and emailed the investor a second time.
--
-- The app now approves drafts only. This is the same rule, held where the
-- service role cannot walk past it: once a notice is sent, its status is sent.
-- An email that went astray is a delivery problem — the email_* columns stay
-- writable for exactly that — not a reason to un-issue the notice. Correcting
-- the figures is a new call, as it always was.
-- ---------------------------------------------------------------------------

create or replace function protect_sent_notice()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'sent' then
    if new.status is distinct from 'sent' then
      raise exception
        'Notice % was sent on % and cannot be moved back to %.',
        old.id, old.sent_at, new.status
        using errcode = 'restrict_violation';
    end if;

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
