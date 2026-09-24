-- ---------------------------------------------------------------------------
-- One-time bootstrap for a hosted environment
-- ---------------------------------------------------------------------------
-- NOT a migration. Run this by hand, once, in the Supabase SQL Editor after
-- `supabase db push` has created the schema. It is kept out of
-- supabase/migrations/ deliberately: a migration runs everywhere, and this
-- creates a named human account, which belongs to one environment only.
--
-- Plain SQL, no psql meta-commands. The SQL Editor sends statements straight
-- to the server and has no psql to interpret `\set`.
--
-- WHY IT IS NEEDED
--
-- `clients` and `client_members` carry read policies and no insert policy, and the
-- app has no sign-up screen. So on a fresh database nobody can sign in, and a
-- user created through the dashboard would still see nothing: with no
-- client_members row, auth_client_ids() returns empty and every fund is invisible.
-- This script creates the first client and puts one user in it. Everything after
-- that is done through the app.
--
-- Replacing this with a real sign-up and invite-a-colleague flow is the proper
-- fix; until then, every new operator is added by editing and re-running this.
--
-- THE PASSWORD BELOW IS IN VERSION CONTROL
--
-- Deliberate, for a development deployment that holds nothing worth taking.
-- Before this environment sees real investor data, either change it (the
-- statement is at the bottom of this file) or remove the account:
--
--   delete from auth.users where email = 'demo@axtara.ai';
--
-- Safe to run more than once: every statement is ON CONFLICT DO NOTHING, so a
-- second run changes nothing. That also means it will NOT change the password
-- of an account that already exists.
--
-- If you get "relation clients does not exist", the migrations have not been
-- pushed yet. Run `supabase db push --linked` first.
-- ---------------------------------------------------------------------------

-- pgcrypto supplies crypt() and gen_salt(). Supabase installs it into the
-- extensions schema, which is not on the SQL Editor's default search path.
set search_path = public, extensions;

-- --- The account -----------------------------------------------------------
-- The id is fixed rather than generated, so re-running is idempotent and the
-- membership below can point at it without a lookup.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- GoTrue reads these into non-nullable strings, so NULL makes every sign-in
  -- fail with "Database error querying schema". They must be empty, not unset.
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, reauthentication_token
)
values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'demo@axtara.ai',

  crypt('password', gen_salt('bf')),   -- the sign-in password

  -- Confirmed on creation, so no confirmation mail has to be delivered or
  -- clicked before the account can sign in.
  now(), now(), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"name": "Axtara Demo"}'::jsonb,
  '', '', '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at
)
values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  'email',
  '{"sub": "00000000-0000-4000-8000-000000000002", "email": "demo@axtara.ai", "email_verified": true}'::jsonb,
  now(), now(), now()
)
on conflict (provider_id, provider) do nothing;

-- --- The client, and the one membership that makes the app visible -----------

insert into clients (id, name)
values ('00000000-0000-4000-8000-0000000000f1', 'Axtara Fund Services')
on conflict (id) do nothing;

insert into client_members (client_id, user_id, role)
values (
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-000000000002',
  'owner'
)
on conflict do nothing;

-- --- Check it worked -------------------------------------------------------
-- Expect exactly one row: the email, the client name, and the role 'owner'.
-- No row means the membership did not land, and the app will sign you in and
-- then show no funds at all.

select u.email, f.name as client, m.role
  from auth.users u
  join client_members m on m.user_id = u.id
  join clients f on f.id = m.client_id
 where u.id = '00000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Changing the password later
--
--   set search_path = public, extensions;
--
--   update auth.users
--      set encrypted_password = crypt('the-new-password', gen_salt('bf')),
--          updated_at = now()
--    where email = 'demo@axtara.ai';
-- ---------------------------------------------------------------------------
