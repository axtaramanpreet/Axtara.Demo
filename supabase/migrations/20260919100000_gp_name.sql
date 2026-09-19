-- ---------------------------------------------------------------------------
-- The general partner's name
-- ---------------------------------------------------------------------------
-- The notice letter opens "on behalf of X, the General Partner of the Fund".
-- Until now there was nowhere to put X, so the letter named only the role.
--
-- Nullable, like the rest of Fund_Setup: a draft may be incomplete, and a
-- notice with no GP name still reads correctly — it says "the General Partner"
-- rather than leaving a gap in the sentence.
-- ---------------------------------------------------------------------------

alter table calls add column if not exists gp_name text;

comment on column calls.gp_name is
  'Legal name of the general partner, as the notice letter names it. NULL falls back to "the General Partner".';
