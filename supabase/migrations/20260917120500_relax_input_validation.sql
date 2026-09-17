-- ---------------------------------------------------------------------------
-- Let the engine own business validation
-- ---------------------------------------------------------------------------
-- The original schema copied rules that the engine already enforces —
-- allocation basis, transfer type and percentage, investor status, due date
-- ordering — into CHECK constraints. That turned out to be wrong twice over.
--
-- Where the mapper coerced a value to satisfy the constraint, the accountant's
-- typo was silently corrected: type "Vibes" as an allocation basis, save,
-- reload, and it now reads "Commitment" with no warning that anything was
-- changed. Where it did not coerce, the save simply failed with a constraint
-- name instead of the engine's plain "Transfer_Pct must be between 0 and 1".
--
-- The division of labour is now explicit:
--
--   the database  — structure: types, keys, uniqueness, and the immutability
--                   of an issued call
--   the engine    — business rules, reported as OK/WARN/FAIL checks against
--                   inputs that are stored exactly as they were entered
--
-- Inputs are a work in progress until the call is issued. Storing them
-- faithfully, warts included, is what lets the Checks tab tell the truth.
-- ---------------------------------------------------------------------------

-- The engine defaults an unrecognised basis to Commitment and says so.
alter table call_components drop constraint call_components_allocation_basis_check;

-- The engine treats anything that is not "Full" as partial, and reports a
-- percentage outside 0–1 as a skipped transfer rather than refusing the row.
alter table call_transfers drop constraint call_transfers_transfer_type_check;
alter table call_transfers drop constraint call_transfers_transfer_pct_check;

-- The engine treats any status other than Active as not participating, which
-- covers firm-specific values like "Withdrawn" without a migration.
alter table call_register drop constraint call_register_status_check;

-- A due date is often typed before the call date it must follow. Ordering is a
-- UI concern during entry, not a reason to reject the row.
alter table calls drop constraint payment_due_on_or_after_call_date;

-- Deliberately kept:
--   calls_reporting_currency_check   — three-letter ISO code, structural
--   calls_rounding_decimals_check    — must fit money_amount's 4 dp
--   notices_status_check             — the workflow the server enforces
--   approved_has_timestamp,
--   sent_has_evidence                — a status must carry its own evidence
