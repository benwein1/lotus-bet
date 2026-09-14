-- A record of who agreed to the terms, and to which version of them.
--
-- Guideline 1.2 requires an app with user-generated content to have rules
-- people have agreed to — the "zero tolerance for objectionable content" EULA
-- Apple asks for. The agreement itself happens on the sign-up screen; this is
-- the part that has to survive it.
--
-- Two columns rather than a boolean. `accepted: true` is worth very little the
-- first time the terms change: it cannot tell you who agreed to *what*, so it
-- cannot tell you who needs asking again. With a version, the accounts that
-- predate a change are a query rather than a guess.

alter table public.users
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.users.terms_version is
  'The TERMS_VERSION constant from src/lib/legal.ts that this account agreed '
  'to. Bump that constant when the published terms change materially.';

-- Readable so the app can tell whether an older account has agreed to the
-- current version; never writable by a client, because an acceptance a client
-- can forge is not a record of anything. Only the signup trigger writes it.
grant select (terms_accepted_at, terms_version) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- Written at signup, from the same metadata the display name travels in
-- ---------------------------------------------------------------------------
-- The alternative — a separate write from the client after `signUp` returns —
-- has a hole in the middle: an account created by a client that dies between
-- the two calls exists with no acceptance on it, and nothing would ever go
-- back and fix it. Carrying it in `raw_user_meta_data` makes the account and
-- its acceptance the same insert.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  v_terms text := nullif(trim(new.raw_user_meta_data ->> 'terms_version'), '');
begin
  -- `username` is here because `…_private_and_duels.sql` put it here, and a
  -- `create or replace` written from the *older* copy of this function silently
  -- drops it. That is exactly the bug CLAUDE.md §6 records under "Usernames":
  -- the trigger was forgotten once already, every account created afterwards
  -- had no handle and could not be challenged, and the backfill made the
  -- existing rows look fine — which is what hid it. Caught here by the duel
  -- section of the harness, which could not look anybody up.
  --
  -- Anything added to this insert in a later migration must carry the whole
  -- column list forward, not just the part that migration is about.
  insert into public.users (
    id, email, phone, display_name, profile_completed, username,
    terms_accepted_at, terms_version
  )
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(v_name, 'Player ' || right(new.id::text, 4)),
    v_name is not null,
    public.suggest_username(new.id, new.email, coalesce(v_name, '')),
    -- Null rather than `now()` when the client did not send a version: an
    -- account created by some other path has genuinely not agreed to anything,
    -- and recording a timestamp for it would be inventing consent.
    case when v_terms is not null then now() else null end,
    v_terms
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Accounts that predate this migration have no acceptance on record, and that
-- is the honest state — they agreed to nothing, because there was nothing to
-- agree to. Deliberately **not** backfilled: a timestamp written by a
-- migration is a record of the migration running, not of anybody consenting.
