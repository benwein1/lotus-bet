-- Two accounts either side of the grandfathering cutoff, so the migration that
-- follows has real work to do.
--
-- Without this the backfill runs against an empty table and passes for the
-- wrong reason — the exact trap CLAUDE.md §7 records, and the one that let the
-- options migration ship a bug that only appeared on a project with history.
--
-- The pair is the point. One row alone would prove the update touches
-- something; it would not prove the cutoff *stops*. The second row is created
-- after the cutoff and must come through untouched, because that is the case
-- protecting every Apple and Google signup waiting on the in-app check.

-- The signup trigger is what normally creates a `public.users` row, and it now
-- refuses an insert without a date of birth... so these are written directly,
-- which is also closer to the truth: these accounts are standing in for rows
-- that predate the rule entirely.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000',
   'f0f0f0f0-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'oldtimer@example.test', 'x',
   now(), '{}'::jsonb, '{"display_name":"Old Timer"}'::jsonb,
   timestamptz '2026-09-10 09:00:00+00', now()),
  ('00000000-0000-0000-0000-000000000000',
   'f0f0f0f0-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'newcomer@example.test', 'x',
   now(), '{}'::jsonb, '{"display_name":"Newcomer"}'::jsonb,
   timestamptz '2026-09-19 18:00:00+00', now())
on conflict (id) do nothing;

-- The trigger created the profile rows, but with `created_at` defaulting to
-- now() rather than the dates above — and `created_at` is the column the cutoff
-- reads. Set it explicitly, or both rows land on the same side of the line and
-- the test proves nothing.
update public.users
   set created_at = timestamptz '2026-09-10 09:00:00+00', age_verified_at = null
 where id = 'f0f0f0f0-0000-4000-8000-000000000001';

update public.users
   set created_at = timestamptz '2026-09-19 18:00:00+00', age_verified_at = null
 where id = 'f0f0f0f0-0000-4000-8000-000000000002';
