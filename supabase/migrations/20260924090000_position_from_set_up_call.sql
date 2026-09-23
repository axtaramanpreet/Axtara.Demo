-- ---------------------------------------------------------------------------
-- The fund position reads the last call that has a register
-- ---------------------------------------------------------------------------
-- `client_positions` took commitments, paid-in and unfunded from the register
-- of the fund's highest-numbered call. Starting a new call creates it empty,
-- so the moment someone pressed "New capital call" the Home card read that
-- empty register and reported the fund as holding nothing: every line 0.00, no
-- investors, no payment due, and the drawdown chart "27.9% of USD 0". The card's
-- subtitle, worked out separately from the call in progress, named the call
-- before it — so the heading and the figures under it disagreed.
--
-- A call with no active investor on its register says nothing about the fund's
-- position yet. The position is now read from the newest call that has one,
-- and `latest_call_no` names that call, so the figures and the call they came
-- from are always the same call. A new call takes over as soon as its register
-- is filled in or carried forward.
--
-- Same columns in the same order, so the view is replaced in place.
-- ---------------------------------------------------------------------------

create or replace view client_positions
with (security_invoker = on)
as
with latest_call as (
  select distinct on (k.client_id)
         k.client_id, k.id as call_id, k.call_no, k.payment_due_date
    from calls k
   where exists (
           select 1
             from call_register r
            where r.call_id = k.id
              and r.status = 'Active'
         )
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
