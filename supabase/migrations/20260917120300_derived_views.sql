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
