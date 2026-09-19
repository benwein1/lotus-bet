-- Sign in with Apple and Google, on the database side.
--
-- Two small things, both of which exist because an OAuth signup does not look
-- like the email one the schema was built around.
--
-- ---------------------------------------------------------------------------
-- 1. The name arrives under a different key
-- ---------------------------------------------------------------------------
-- `signUp` puts the display name in `raw_user_meta_data.display_name`, because
-- the app chose that key and controls both ends. An OAuth provider chooses its
-- own: GoTrue copies the identity's claims straight through, so Google lands a
-- `name` and a `full_name`, and Apple lands a `full_name` assembled from the
-- name it hands over — and neither writes `display_name`.
--
-- So without this, every account created through a social button arrives named
-- "Player 3f2a" with `profile_completed = false`, and is routed to the
-- profile-setup screen to type a name the provider already gave us.
--
-- `coalesce` in that order because `display_name` is the app's own key and must
-- keep winning when it is present: the email signup path sets it, and it has
-- already been through `prepareContent`, which the provider's string has not.
--
-- ---------------------------------------------------------------------------
-- The rule this function keeps getting caught by
-- ---------------------------------------------------------------------------
-- `username` and the terms columns are both here because earlier migrations put
-- them here, and a `create or replace` written from an older copy silently
-- drops whatever it does not mention. CLAUDE.md §6 records that happening once
-- already — the username assignment went missing, every account created after
-- it had no handle and could not be challenged, and the backfill made the
-- existing rows look fine, which is what hid it.
--
-- The whole column list goes forward. Every time.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The app's own key first, then the two an OAuth provider might use.
  v_name text := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), '')
  );
  v_terms text := nullif(trim(new.raw_user_meta_data ->> 'terms_version'), '');
begin
  insert into public.users (
    id, email, phone, display_name, profile_completed, username,
    terms_accepted_at, terms_version
  )
  values (
    new.id,
    new.email,
    new.phone,
    -- Clamped to 40 to satisfy `users_display_name_length`. A provider's
    -- string has not been through the app's own length check, and a signup
    -- that fails on a constraint here fails the whole GoTrue insert — the
    -- account would not exist and the error would surface as "could not sign
    -- in", which is an unfindable bug.
    coalesce(left(v_name, 40), 'Player ' || right(new.id::text, 4)),
    v_name is not null,
    public.suggest_username(new.id, new.email, coalesce(v_name, '')),
    -- Null rather than now() when the client did not send a version: an
    -- account created by some other path has genuinely not agreed to anything,
    -- and recording a timestamp for it would be inventing consent. A social
    -- signup is exactly that path — it agrees through `accept_terms` below,
    -- after the button it actually tapped.
    case when v_terms is not null then now() else null end,
    v_terms
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Agreeing to the terms without a signup form to carry it
-- ---------------------------------------------------------------------------
-- The email flow carries the accepted version in `raw_user_meta_data`, so the
-- account and its acceptance are the same insert and there is no window in
-- which one exists without the other.
--
-- `signInWithOAuth` and `signInWithIdToken` take no metadata. There is nowhere
-- to put it: the account is created by GoTrue from the provider's claims, and
-- the first moment the app can say anything is after a session exists. So this
-- is the one place an acceptance is a second write, and it is an RPC rather
-- than an update because `terms_accepted_at` and `terms_version` are
-- deliberately absent from the client's UPDATE grant — an acceptance a client
-- can write freely is not a record of anything.
--
-- What the function will not do is let a client name its own timestamp or
-- backdate one. It writes `now()`, and it takes only the version string.
--
-- It is also how a *re-acceptance* works when the terms change: the app
-- compares `users.terms_version` against `TERMS_VERSION` and asks again. That
-- is why this updates rather than refusing when a row already has a version.
create or replace function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_version text := nullif(trim(p_version), '');
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if v_version is null then
    raise exception 'A terms version is required.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.users
     set terms_accepted_at = now(),
         terms_version     = v_version
   where id = v_me;
end;
$$;

comment on function public.accept_terms(text) is
  'Records that the signed-in account agreed to a version of the terms. Used '
  'by the social sign-in buttons, which have no signup form to carry the '
  'version in metadata the way email signup does.';

-- `…_anon_rpc_lockdown.sql` revoked the default execute grant from PUBLIC and
-- anon and changed the default privileges so new functions do not get one, so
-- this is the only grant it needs — and it deliberately does not go to anon.
grant execute on function public.accept_terms(text) to authenticated;
