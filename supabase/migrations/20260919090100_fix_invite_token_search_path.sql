-- "function gen_random_bytes(integer) does not exist" — Share invite was dead.
--
-- ---------------------------------------------------------------------------
-- What happened
-- ---------------------------------------------------------------------------
-- `create_group_invite` mints its token with `gen_random_bytes(9)`, which is a
-- **pgcrypto** function. `…_group_invites.sql` declared the function with
-- `set search_path = public`, and on Supabase pgcrypto is not in `public` — the
-- platform installs it into the `extensions` schema. So the name resolved
-- against a schema that does not contain it and the call failed outright.
--
-- Every tap on "Share invite" hit it. The group screen rendered the error in
-- place of the link, which is how it was found; nothing else in the app calls
-- this function, so it failed alone and silently until somebody tried to invite
-- a friend.
--
-- `create extension if not exists pgcrypto;` at the top of `…_init.sql` looked
-- like it covered this and does not: on a Supabase project the extension is
-- already installed, so `if not exists` is satisfied and the statement is a
-- no-op that never moves it into `public`.
--
-- ---------------------------------------------------------------------------
-- Why `gen_random_uuid()` elsewhere was fine
-- ---------------------------------------------------------------------------
-- Worth stating, because the two look like the same dependency and are not.
-- Since PostgreSQL 13 `gen_random_uuid()` is a **core built-in** and needs no
-- extension at all, so every `default gen_random_uuid()` in the schema resolves
-- wherever it is used. `gen_random_bytes` is still pgcrypto-only. That
-- asymmetry is exactly why this was the one call that broke.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- `set search_path = public, extensions`, which is the same line the seed
-- scripts already carry and for the same reason. Chosen over hard-coding
-- `extensions.gen_random_bytes(...)` because pgcrypto's home is a property of
-- the deployment rather than of this project: it is in `extensions` on
-- Supabase and commonly in `public` on a self-hosted or local database. A
-- search path resolves either; a schema-qualified call picks one and breaks the
-- other.
--
-- Adding `extensions` to the path of a `security definer` function is safe
-- here: it is a platform-owned schema that no client can write to, so nothing
-- a user controls can shadow a name in it.
--
-- The body is otherwise byte-for-byte what `…_group_invites.sql` defined —
-- reuse of a live invite included, since minting per tap is what makes
-- revocation meaningless.

create or replace function public.create_group_invite(
  p_group_id uuid,
  p_ttl_hours integer default 168
)
returns public.group_invites
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.group_invites;
  v_kind text;
  v_ttl integer := least(greatest(coalesce(p_ttl_hours, 168), 1), 720);
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'Not a member of that group' using errcode = 'insufficient_privilege';
  end if;

  select kind into v_kind from public.groups where id = p_group_id;

  -- A duel is a two-person group and the whole promise of it is that it stays
  -- that way. An invite link into one would quietly add a third person to
  -- "just the two of you" — and to a running balance that both sides read as
  -- pairwise.
  if v_kind = 'duel' then
    raise exception 'A one-on-one challenge cannot be shared'
      using errcode = 'check_violation';
  end if;

  -- Reuse a live one rather than minting on every tap. Otherwise sharing a
  -- group four times leaves four working links, each with its own expiry, and
  -- revoking "the" link stops meaning anything. Same reasoning as create_duel.
  select * into v_invite
  from public.group_invites i
  where i.group_id = p_group_id
    and i.revoked_at is null
    and i.expires_at > now()
    and (i.max_uses is null or i.uses < i.max_uses)
  order by i.expires_at desc
  limit 1;

  if v_invite.id is not null then
    return v_invite;
  end if;

  insert into public.group_invites (group_id, token, created_by, expires_at)
  values (
    p_group_id,
    -- 9 bytes = 72 bits, and base64 of 9 bytes is 12 characters with no
    -- padding — which is why 9 rather than 8 or 10. `translate` makes it
    -- URL-safe, since the token goes in a link.
    translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'),
    auth.uid(),
    now() + make_interval(hours => v_ttl)
  )
  returning * into v_invite;

  return v_invite;
end;
$$;

-- CLAUDE.md §10: the platform re-grants execute on a newly created object, and
-- `create or replace` counts. Re-asserting both is not belt-and-braces — it is
-- the finding `…_relock_anon_execute.sql` exists to record.
revoke execute on function public.create_group_invite(uuid, integer) from public, anon;
grant execute on function public.create_group_invite(uuid, integer) to authenticated;
