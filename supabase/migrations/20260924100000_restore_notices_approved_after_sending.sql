-- ---------------------------------------------------------------------------
-- Put back notices that "Approve all" moved out of sent
-- ---------------------------------------------------------------------------
-- Before 20260923120000_sent_is_final, "Approve all" upserted every active
-- investor to 'approved', including ones already sent. Production has two such
-- rows: AXTARA Demo Fund I, Call No. 1, LP01 and LP02 — sent at
-- 2026-09-20 11:43:39 UTC, then swept to 'approved' by an "Approve all" at
-- 11:49:47 (audit_log 'notices.approved'). Neither was sent again, so each still
-- carries the payload, sent_at and result_id it was issued with.
--
-- Left as 'approved', the next "Send" would re-issue them — sendNotices takes
-- every approved notice — overwriting the record of what the investor was told
-- and emailing them twice. Their evidence is intact, so restoring the status
-- restores the notice exactly. `sent_is_final` only guards rows whose old
-- status is 'sent', so it allows this and then protects them from here on.
--
-- `approved_at` is left as it stands. It records the sweep, not the original
-- approval; the original is in audit_log, which is the authority on who
-- approved what and when.
--
-- Matches nothing on a database where the sweep never happened, so it is safe
-- to run everywhere.
-- ---------------------------------------------------------------------------

update notices
   set status = 'sent'
 where status <> 'sent'
   and sent_at is not null
   and payload is not null
   and result_id is not null;
