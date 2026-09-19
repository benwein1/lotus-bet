-- Betta is a 16+ app, enforced in the database.
--
-- ---------------------------------------------------------------------------
-- Why a column that is not the date of birth
-- ---------------------------------------------------------------------------
-- The obvious schema is `users.date_of_birth date`. It is the wrong one. Once
-- the age has been checked, the birth date has no further job in this product:
-- nothing shows it, nothing sorts by it, no feature is planned that needs it.
-- Keeping it would mean holding a piece of identity data on every account
-- forever to answer a question that was already answered at signup — and a
-- date of birth next to a display name and an email is a materially more
-- sensitive row than either on its own.
--
-- So the date of birth is **passed in, checked, and discarded**. What survives
-- is `age_verified_at`: proof the check happened, with no way to reconstruct
-- what it was checking. That is also what makes this safe to run for existing
-- accounts — nobody has to hand over a birthday that then sits in a table.
--
-- ---------------------------------------------------------------------------
-- Why the check is here and not only in the app
-- ---------------------------------------------------------------------------
-- A client-side gate is a suggestion. `supabase-js` talks to PostgREST with
-- the anon key, so anybody can skip the sign-up screen entirely and call the
-- API directly. The three layers below are the ones that hold:
--
--   1. `handle_new_auth_user` refuses to create an account whose metadata
--      carries an under-age date of birth — the signup transaction aborts.
--   2. `confirm_minimum_age()` is the only way to set `age_verified_at`, and
--      it computes the age in SQL from `current_date`. A client that lies
--      about the age gets caught; a client that lies about the *date* is
--      making a claim under the terms, which is the same position every age
--      gate on the internet is in.
--   3. `require_age_verified()` refuses every content write from an account
--      that has not passed (2). This is what makes the gate unbypassable
--      rather than merely present.
--
-- Deliberately **not** done as RLS: CLAUDE.md §6 warns that a policy on table
-- X whose `using` clause re-queries X breaks `INSERT ... RETURNING`, which is
-- how `queries.ts` writes. A `before insert` trigger has no such trap, does
-- not interact with the existing policy set at all, and sits next to the
-- rate-limit triggers that already guard exactly these tables.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists age_verified_at timestamptz;

comment on column public.users.age_verified_at is
  'When this account confirmed it meets the 16+ minimum. Set by the signup '
  'trigger or by confirm_minimum_age(); never writable by a client. The date '
  'of birth itself is deliberately not stored — see the head of '
  '20260919090000_minimum_age.sql.';

-- Readable so the app knows whether to show the one-time age check.
-- `…_user_column_privileges.sql` revoked the blanket grant on this table, so a
-- column added afterwards has to name itself or the client cannot see it.
--
-- Absent from the UPDATE grant on purpose: an account that could stamp its own
-- `age_verified_at` would make the whole gate decorative.
grant select (age_verified_at) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- The rule, once
-- ---------------------------------------------------------------------------
-- `stable` rather than `immutable`: it reads `current_date`, so its answer
-- changes — which is the point. Somebody who is 15 today is 16 next year
-- without anything being rewritten.
--
-- Mirrors `ageInYears` in src/lib/age.ts, including counting the birthday as
-- reached on the day. Postgres `age()` already truncates toward zero the same
-- way, so the two agree on every boundary.
create or replace function public.meets_minimum_age(p_date_of_birth date)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_date_of_birth is not null
     and p_date_of_birth <= (current_date - interval '16 years')::date;
$$;

comment on function public.meets_minimum_age(date) is
  'The 16+ rule. Kept as one function so the signup trigger and '
  'confirm_minimum_age() cannot drift apart.';

revoke execute on function public.meets_minimum_age(date) from public, anon;
grant execute on function public.meets_minimum_age(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Signup: reject an under-age account outright
-- ---------------------------------------------------------------------------
-- CLAUDE.md §6 records the trap this function has already fallen into once: a
-- `create or replace` written from an older copy silently drops whatever a
-- later migration added, and the backfill made the damage invisible. So the
-- whole column list is carried forward here — `username`, `terms_accepted_at`
-- and `terms_version` included — and anything added after this must do the
-- same.
--
-- The date of birth arrives in `raw_user_meta_data` alongside the display name
-- and the terms version, for the reason that migration gives: a second call
-- from the client has a hole in the middle. It is read, checked, and never
-- written anywhere.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  v_terms text := nullif(trim(new.raw_user_meta_data ->> 'terms_version'), '');
  v_dob_text text := nullif(trim(new.raw_user_meta_data ->> 'date_of_birth'), '');
  v_dob date;
begin
  -- A malformed date is refused rather than ignored. Ignoring it would mean a
  -- client could get past the age check by sending rubbish instead of a date.
  if v_dob_text is not null then
    begin
      v_dob := v_dob_text::date;
    exception when others then
      raise exception 'That date of birth is not a valid date.'
        using errcode = 'invalid_parameter_value';
    end;

    if not public.meets_minimum_age(v_dob) then
      -- Aborts the insert into auth.users, so no account is created at all.
      raise exception 'You must be at least 16 years old to use this app.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.users (
    id, email, phone, display_name, profile_completed, username,
    terms_accepted_at, terms_version, age_verified_at
  )
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(v_name, 'Player ' || right(new.id::text, 4)),
    v_name is not null,
    public.suggest_username(new.id, new.email, coalesce(v_name, '')),
    case when v_terms is not null then now() else null end,
    v_terms,
    -- Null when no date of birth came with the signup, which is the normal
    -- case for Apple and Google: neither provider returns one. Those accounts
    -- exist but can write nothing until they pass the in-app check. Recording
    -- a timestamp here would be inventing a verification that never happened.
    case when v_dob is not null then now() else null end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The in-app check, for every account the signup form did not cover
-- ---------------------------------------------------------------------------
-- Social sign-ins, and every account that predates this migration. The date of
-- birth is a parameter, not a column: it lives for the length of this call.
create or replace function public.confirm_minimum_age(p_date_of_birth date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_date_of_birth is null then
    raise exception 'A date of birth is required.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_date_of_birth > current_date then
    raise exception 'That date is in the future.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.meets_minimum_age(p_date_of_birth) then
    raise exception 'You must be at least 16 years old to use this app.'
      using errcode = 'check_violation';
  end if;

  -- Idempotent, and it never moves an existing stamp: the first confirmation
  -- is the one that happened, and re-running this must not look like a fresh
  -- check on an account that has already passed.
  update public.users
     set age_verified_at = coalesce(age_verified_at, now())
   where id = v_me;
end;
$$;

comment on function public.confirm_minimum_age(date) is
  'One-time 16+ confirmation for accounts the signup form did not cover. The '
  'date of birth is checked and discarded; only age_verified_at is written.';

revoke execute on function public.confirm_minimum_age(date) from public, anon;
grant execute on function public.confirm_minimum_age(date) to authenticated;

-- ---------------------------------------------------------------------------
-- The enforcement: no content from an unverified account
-- ---------------------------------------------------------------------------
-- `security definer` because it reads `public.users`, which the caller can
-- only see through RLS — and a member can read their own row, but relying on
-- that would make the check depend on a policy rather than on a fact.
create or replace function public.require_age_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role and the signup trigger run with no `auth.uid()`. They are
  -- not user writes and must not be blocked, or the seed scripts, the notify
  -- function and every future backfill break.
  if auth.uid() is null then
    return new;
  end if;

  if not exists (
    select 1 from public.users
     where id = auth.uid() and age_verified_at is not null
  ) then
    raise exception 'Confirm your date of birth before posting.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.require_age_verified() from public, anon;

-- Every table a user can put content or activity into. Reading is untouched:
-- an unverified account can still see the app, which is what makes the in-app
-- check a one-screen interruption rather than a lockout.
drop trigger if exists bets_require_age on public.bets;
create trigger bets_require_age
  before insert on public.bets
  for each row execute function public.require_age_verified();

drop trigger if exists bet_positions_require_age on public.bet_positions;
create trigger bet_positions_require_age
  before insert on public.bet_positions
  for each row execute function public.require_age_verified();

drop trigger if exists bet_comments_require_age on public.bet_comments;
create trigger bet_comments_require_age
  before insert on public.bet_comments
  for each row execute function public.require_age_verified();

drop trigger if exists bet_likes_require_age on public.bet_likes;
create trigger bet_likes_require_age
  before insert on public.bet_likes
  for each row execute function public.require_age_verified();

drop trigger if exists groups_require_age on public.groups;
create trigger groups_require_age
  before insert on public.groups
  for each row execute function public.require_age_verified();

drop trigger if exists bet_media_require_age on public.bet_media;
create trigger bet_media_require_age
  before insert on public.bet_media
  for each row execute function public.require_age_verified();

-- ---------------------------------------------------------------------------
-- Existing accounts are NOT backfilled, and that is a decision to review
-- ---------------------------------------------------------------------------
-- Every row that predates this migration has `age_verified_at = null`, because
-- that is the truth: nobody was ever asked. The app routes those accounts to a
-- one-time confirmation screen on their next open, so the experience is one
-- question rather than a locked account — they keep their groups, their
-- history and their balances throughout, and reading is never blocked.
--
-- What remains a business decision: how long to leave an account that never
-- answers. It can write nothing, so it cannot cause harm, but it is also not
-- evidence that anybody under 16 is present. Deleting or disabling those
-- accounts on a timer is a product call, not a technical one, and is
-- deliberately not implemented here.
