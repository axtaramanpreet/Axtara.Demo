-- ---------------------------------------------------------------------------
-- Who signs the notice
-- ---------------------------------------------------------------------------
-- The notice ends "Best Regards, / <name> / <title> / <general partner>".
-- Prepared_By already existed but is traceability — who assembled the call —
-- which is not the same person as the one whose name goes under the sign-off.
--
-- Nullable, like the rest of Fund_Setup. A blank line is dropped rather than
-- printed empty, so a notice nobody has named still ends properly.
-- ---------------------------------------------------------------------------

alter table calls
  add column if not exists signatory_name  text,
  add column if not exists signatory_title text;

comment on column calls.signatory_name is 'Name under the sign-off. NULL drops the line.';
comment on column calls.signatory_title is 'Title under the name. NULL drops the line.';
