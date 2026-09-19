-- A minimal world to run the policy checks against: one real account, one
-- group whose invite code is RHMXXW, one open bet, and an outsider who
-- belongs to nothing.
--
-- The seed script (`supabase/seed/test_members.sql`) is run on top of this by
-- `run.sh`, which is what makes that script part of the tested surface rather
-- than something we hope works.

-- The grants `anon` and `authenticated` get on a real project are set up as
-- default privileges in `00_supabase_stub.sql`, before the migrations run, so
-- that a migration revoking one of them still means something here.
--
-- The one table clients may only read. `resolve-bet` writes it with the
-- service role, which bypasses both the grant and the policy.
revoke insert, update, delete on public.bet_ledger_entries from anon, authenticated;

-- --- The account that owns the group ---------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-0000-4000-8000-000000000000',
  'authenticated', 'authenticated', 'owner@example.test', 'x',
  now(), '{}'::jsonb,
  '{"display_name":"Group Owner","date_of_birth":"1990-01-01"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

-- --- Somebody who is in no group at all ------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  'dddddddd-0000-4000-8000-000000000000',
  'authenticated', 'authenticated', 'outsider@example.test', 'x',
  now(), '{}'::jsonb,
  '{"display_name":"Outsider","date_of_birth":"1990-01-01"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

-- --- The group the seed script looks for -----------------------------------
insert into public.groups (id, name, emoji, created_by, invite_code)
values (
  'bbbbbbbb-0000-4000-8000-000000000000',
  'The Test Group', '⚽️',
  'aaaaaaaa-0000-4000-8000-000000000000',
  'RHMXXW'
)
on conflict (id) do nothing;

insert into public.group_members (group_id, user_id, role)
values (
  'bbbbbbbb-0000-4000-8000-000000000000',
  'aaaaaaaa-0000-4000-8000-000000000000',
  'admin'
)
on conflict do nothing;

-- An open bet of the owner's, so the seed script has something to take sides
-- on and section 3 of it is actually exercised.
insert into public.bets (
  id, group_id, creator_id, title, option_a_label, option_b_label, total_pot_agorot
)
values (
  'cccccccc-0000-4000-8000-000000000000',
  'bbbbbbbb-0000-4000-8000-000000000000',
  'aaaaaaaa-0000-4000-8000-000000000000',
  'An existing open bet of mine', 'Yes', 'No', 4000
)
on conflict (id) do nothing;
