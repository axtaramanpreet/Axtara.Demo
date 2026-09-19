-- ---------------------------------------------------------------------------
-- Delivery is not the same event as issuing
-- ---------------------------------------------------------------------------
-- `status = 'sent'` means a notice was issued: the figures were frozen, the
-- snapshot was written, and the call was locked. That is the record of what the
-- fund told an investor, and it is immutable.
--
-- Whether the email actually arrived is a separate question with a separate
-- answer. A bounced address, an expired API key or a provider outage must not
-- leave the record saying an investor was told something they never received —
-- and equally must not be fixable by re-issuing the call, because issuing is
-- permanent by design.
--
-- So delivery gets its own columns, and can be retried as often as needed
-- without touching a single figure. `protect_sent_notice` already allows this:
-- it freezes payload, sent_at, result_id and sent_to_email, and nothing else.
-- ---------------------------------------------------------------------------

alter table notices
  add column if not exists email_status text
    check (email_status is null or email_status in ('pending', 'delivered', 'failed')),
  add column if not exists email_message_id  text,
  add column if not exists email_error       text,
  add column if not exists email_attempted_at timestamptz,
  -- Where it actually went, which is not always sent_to_email: while
  -- EMAIL_OVERRIDE_TO is set every notice is redirected to one test address,
  -- and the record has to show that rather than implying an investor was
  -- contacted.
  add column if not exists email_delivered_to text;

comment on column notices.email_status is
  'Delivery outcome, separate from status. NULL means no attempt has been made.';
comment on column notices.email_delivered_to is
  'The address actually used. Differs from sent_to_email when a send override is in force.';

create index if not exists notices_email_status_idx
  on notices (call_id, email_status)
  where email_status is distinct from 'delivered';
