-- Email + password accounts.
--
-- Migrations are append-only: this changes the shape set up by
-- 20260904090000_init.sql rather than editing it.
--
-- Split from the bet-media migration on purpose. The media half needs rights
-- on `storage.objects` that not every project grants from the SQL editor, and
-- a failure there must not roll back the account changes the app cannot start
-- without.

-- ---------------------------------------------------------------------------
-- Accounts move from phone OTP to email + password
-- ---------------------------------------------------------------------------
-- `phone` stays on the table so accounts created under the old flow keep
-- working, but it is no longer required and no longer the identity column.
alter table public.users
  add column if not exists email text,
  add column if not exists profile_completed boolean not null default false;

alter table public.users alter column phone drop not null;

create unique index if not exists users_email_key on public.users (lower(email));

-- Existing rows: fill in the email from the auth record, and drop the junk
-- `phone` the old trigger wrote. Under phone OTP it stored the real number,
-- but for an email signup made before this migration it fell back to
-- `new.id::text` — the user's own uuid, which would then show up under their
-- name on the profile screen.
update public.users u
set email = a.email
from auth.users a
where a.id = u.id and u.email is null;

update public.users
set phone = null
where phone = id::text;

-- Anyone who already picked a real name has a complete profile. The old code
-- detected that by pattern-matching the placeholder, which trapped a user who
-- genuinely called themselves "Player 7"; this replaces the guess with a fact.
--
-- The placeholder is `'Player ' || right(<phone or uuid>, 4)`, so its tail is
-- four hex characters for an email signup and four digits for a phone one —
-- matching only digits here would mark a still-unnamed "Player 8f2c" as
-- complete and never prompt them.
update public.users
set profile_completed = true
where display_name !~* '^Player [0-9a-f]{0,4}$';

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------
-- The sign-up form sends the display name in `raw_user_meta_data`, so a new
-- account normally arrives already named and skips profile setup entirely.
-- Without one we seed a placeholder and leave `profile_completed` false.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  insert into public.users (id, email, phone, display_name, profile_completed)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(v_name, 'Player ' || right(new.id::text, 4)),
    v_name is not null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
