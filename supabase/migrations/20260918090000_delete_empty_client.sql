-- ---------------------------------------------------------------------------
-- Let a fund created by mistake be removed
-- ---------------------------------------------------------------------------
-- "+ New client" could add a fund but nothing could ever remove one, so a
-- typo was permanent.
--
-- This is narrower than it looks. Deleting a client cascades to its calls, and
-- call_register.investor_id is ON DELETE RESTRICT, so a fund that has ever had
-- a register refuses to go. In practice only a fund with no call history can be
-- deleted — which is exactly the mistake worth undoing — and anything with
-- investors behind it is protected by the same rule that protects issued calls.
--
-- Funds that have done business are retired with `archived_at`, not deleted.
-- ---------------------------------------------------------------------------

create policy clients_delete on clients
  for delete to authenticated
  using (auth_can_write_firm(firm_id));
