-- ---------------------------------------------------------------------------
-- One-time bootstrap for a hosted environment
-- ---------------------------------------------------------------------------
-- NOT a migration. Run this by hand, once, in the Supabase SQL Editor after
-- `supabase db push` has created the schema. It is kept out of
-- supabase/migrations/ deliberately: a migration runs everywhere, and this
-- creates a named human account, which belongs to one environment only.
--
-- WHY IT IS NEEDED
--
-- `firms` and `firm_members` carry read policies and no insert policy, and the
-- app has no sign-up screen. So on a fresh database nobody can sign in, and a
-- user created through the dashboard would still see nothing: with no
-- firm_members row, auth_firm_ids() returns empty and every fund is invisible.
-- This script creates the first firm and puts one user in it. Everything after
-- that is done through the app.
--
-- Replacing this with a real sign-up and invite-a-colleague flow is the proper
-- fix; until then, every new operator is added by editing and re-running this.
--
-- BEFORE YOU RUN IT
--
--   1. Replace PUT_THE_PASSWORD_HERE below. Do not commit the replacement.
--   2. This account is for a development deployment. Delete it before the
--      environment holds real investor data:
--
--        delete from auth.users where email = 'dev@axtara.local';
--
-- Safe to run more than once: every statement is ON CONFLICT DO NOTHING, so a
-- second run changes nothing. That also means it will NOT update the password
-- of an account that already exists — see the bottom of this file for that.
-- ---------------------------------------------------------------------------

-- Fixed ids, so re-running is idempotent and so the firm can be referred to
-- from other scripts without a lookup.
\set user_id   '''00000000-0000-4000-8000-000000000001'''
\set firm_id   '''00000000-0000-4000-8000-0000000000f1'''
\set demo_mail '''dev@axtara.local'''
\set demo_pass '''PUT_THE_PASSWORD_HERE'''

-- --- The account -----------------------------------------------------------

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
  :user_id::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  :demo_mail,
  crypt(:demo_pass, gen_salt('bf')),
  -- Confirmed on creation: dev@axtara.local cannot receive mail, so an
  -- unconfirmed account could never be confirmed.
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
  :user_id::uuid, :user_id::uuid, :user_id,
  'email',
  json_build_object('sub', :user_id, 'email', :demo_mail, 'email_verified', true)::jsonb,
  now(), now(), now()
)
on conflict (provider_id, provider) do nothing;

-- --- The firm, and the one membership that makes the app visible -----------

insert into firms (id, name)
values (:firm_id::uuid, 'Axtara Fund Services')
on conflict (id) do nothing;

insert into firm_members (firm_id, user_id, role)
values (:firm_id::uuid, :user_id::uuid, 'owner')
on conflict do nothing;

-- --- Check it worked -------------------------------------------------------
-- Expect one row: the email, the firm name, and the role 'owner'. If the role
-- column is empty the membership did not land and the app will show no funds.

select u.email, f.name as firm, m.role
  from auth.users u
  join firm_members m on m.user_id = u.id
  join firms f on f.id = m.firm_id
 where u.id = :user_id::uuid;

-- ---------------------------------------------------------------------------
-- Changing the password later
--
--   update auth.users
--      set encrypted_password = crypt('the-new-password', gen_salt('bf')),
--          updated_at = now()
--    where email = 'dev@axtara.local';
-- ---------------------------------------------------------------------------
