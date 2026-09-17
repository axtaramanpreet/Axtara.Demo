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
