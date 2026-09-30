-- ---------------------------------------------------------------------------
-- When equalization interest runs to, and interest on the catch-up fee
-- ---------------------------------------------------------------------------
-- Two terms, from the LPA, for a later closing:
--
--   equalization_interest_until
--     closing_date         interest on the late investor's share of earlier
--                          calls runs from each call's due date to the closing
--     collection_due_date  ... to the due date of the call or statement that
--                          collects it, when the late investor actually pays
--
--   catch_up_fee_until
--     billed_periods       the catch-up fee covers the fee periods already billed
--                          to the investors in before; every later period bills
--                          the late investor in full, like everyone else
--     closing_date         it covers every day up to the closing; later periods
--                          bill the late investor from that day
--
--   catch_up_fee_interest
--     none                 no interest on the catch-up management fee
--     first_close          on the whole catch-up fee, from the first closing
--                          to the late investor's closing
--     per_period           on each fee period's part, from that period's start
--                          to the late investor's closing
--
-- Blank means the fund manager's usual rule: collection_due_date,
-- billed_periods and first_close. What was already finalised or sent keeps what it said.
--
-- A statement for a closing settled now carries the date it is payable by,
-- chosen when the statements are approved; interest runs to it.
-- ---------------------------------------------------------------------------

alter table fund_terms
  add column equalization_interest_until text
    check (equalization_interest_until is null or equalization_interest_until in ('closing_date', 'collection_due_date')),
  add column catch_up_fee_interest text
    check (catch_up_fee_interest is null or catch_up_fee_interest in ('none', 'first_close', 'per_period')),
  add column catch_up_fee_until text
    check (catch_up_fee_until is null or catch_up_fee_until in ('billed_periods', 'closing_date'));

comment on column fund_terms.equalization_interest_until is
  'Equalization interest on capital runs to: closing_date or collection_due_date (blank: collection_due_date).';
comment on column fund_terms.catch_up_fee_until is
  'What the catch-up fee covers: billed_periods (the fee periods already billed to the investors in before) or closing_date (blank: billed_periods).';
comment on column fund_terms.catch_up_fee_interest is
  'Interest on the catch-up management fee: none, first_close or per_period (blank: first_close).';

alter table closing_statements
  add column payment_due_date date;

comment on column closing_statements.payment_due_date is
  'The date the statement is payable by, set when it is approved; interest runs to it.';

-- Statements approved before a date was asked for have none: they go back to
-- draft, to be approved again with one. (Nothing was sent; they can be
-- approved again at once.) A statement sent before keeps having no date — it
-- was sent without one — so only an approved statement must carry it; sending
-- keeps the date it was approved with.
update closing_statements
   set status = 'draft', approved_at = null, approved_by = null, updated_at = now()
 where status = 'approved' and payment_due_date is null;

alter table closing_statements
  add constraint statement_approved_has_due_date
    check (status <> 'approved' or payment_due_date is not null);

-- The due date is part of what was sent: interest ran to it.
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
       or new.investor_id is distinct from old.investor_id
       or new.payment_due_date is distinct from old.payment_due_date then
      raise exception 'Statement % was sent on %; what was sent cannot change.', old.id, old.sent_at
        using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
