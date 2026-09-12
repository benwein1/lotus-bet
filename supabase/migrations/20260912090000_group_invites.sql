-- Shareable invite links for a group.
--
-- Groups already had `invite_code`: six characters, printed on the group
-- screen, typed in by hand on the join screen. That is a good thing to read
-- out loud in a room and a bad thing to paste into WhatsApp, because it never
-- expires and it never changes. Anyone who scrolls far enough back in a chat
-- can still join a year later, and the only way to stop them is to abandon the
-- group.
--
-- So a link is its own object: a long random token with an expiry, minted on
-- demand, revocable, and countable. The six-character code stays exactly as it
-- was — it is the better affordance for "read this out to me" — and the two
-- live side by side.

-- ---------------------------------------------------------------------------
-- The invite
-- ---------------------------------------------------------------------------
create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- base64url of 9 random bytes: 12 characters, 72 bits. Long enough that
  -- guessing one is not a strategy, short enough to survive a chat app's
  -- link preview without wrapping.
  token text not null unique,
  created_by uuid not null references public.users (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- null means "as many people as the link reaches". A number is there for
  -- the day someone wants a single-use link; nothing mints one yet.
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);

create index if not exists group_invites_group_id_idx
  on public.group_invites (group_id, expires_at desc);

alter table public.group_invites enable row level security;

-- Members can see their group's invites — that is what lets the group screen
-- show a live link and say when it runs out. Nobody writes this table
-- directly: both paths below are SECURITY DEFINER, so there is no INSERT,
-- UPDATE or DELETE policy at all and a client cannot mint itself an invite to
-- a group it is not in, or quietly reset another group's expiry.
create policy group_invites_select_members on public.group_invites
  for select
  using (public.is_group_member(group_id));

-- ---------------------------------------------------------------------------
-- Minting
-- ---------------------------------------------------------------------------
-- Any member may invite, which is the rule the six-character code already had:
-- it is printed on the group screen for everyone in the group to read. Making
-- links admin-only would be a different, stricter product than the one that
-- already shipped.
create or replace function public.create_group_invite(
  p_group_id uuid,
  p_ttl_hours integer default 168 -- a week
)
returns public.group_invites
language plpgsql
security definer
set search_path = public
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
    translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'),
    auth.uid(),
    now() + make_interval(hours => v_ttl)
  )
  returning * into v_invite;

  return v_invite;
end;
$$;

-- Stops working immediately, without touching the group. The creator or any
-- admin can pull a link back.
create or replace function public.revoke_group_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.group_invites;
begin
  select * into v_invite from public.group_invites where token = p_token;
  if v_invite.id is null then
    return; -- already gone; nothing to say
  end if;

  if v_invite.created_by <> auth.uid() and not public.is_group_admin(v_invite.group_id) then
    raise exception 'Only whoever made the link, or an admin, can revoke it'
      using errcode = 'insufficient_privilege';
  end if;

  update public.group_invites set revoked_at = now() where id = v_invite.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeeming
-- ---------------------------------------------------------------------------
-- Every refusal is its own message. "That link doesn't work" is useless to
-- somebody standing in front of a group they were invited to ten minutes ago;
-- "that link expired" tells them to go ask for another.
create or replace function public.join_group_with_invite(p_token text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.group_invites;
  v_group public.groups;
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invite
  from public.group_invites
  where token = trim(p_token);

  if v_invite.id is null then
    raise exception 'That invite link is not valid' using errcode = 'no_data_found';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'That invite link was cancelled' using errcode = 'no_data_found';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'That invite link has expired' using errcode = 'no_data_found';
  end if;

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'That invite link has already been used' using errcode = 'no_data_found';
  end if;

  select * into v_group from public.groups where id = v_invite.group_id;
  if v_group.id is null then
    raise exception 'That group no longer exists' using errcode = 'no_data_found';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  -- An INSERT ... ON CONFLICT DO NOTHING reports zero rows when the member was
  -- already there. Opening the same link twice — which is exactly what happens
  -- when someone taps it again to get back to the group — must not burn a use.
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.group_invites set uses = uses + 1 where id = v_invite.id;
  end if;

  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- The same duel guard on the code path
-- ---------------------------------------------------------------------------
-- `join_group_with_code` predates duels and matches on `invite_code` alone, so
-- a duel's auto-generated code let a third person walk into a one-on-one. The
-- link path refuses it above; this closes the older door for the same reason.
create or replace function public.join_group_with_code(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group
  from public.groups g
  where upper(g.invite_code) = upper(trim(p_code));

  if v_group.id is null then
    raise exception 'No group found for that invite code'
      using errcode = 'no_data_found';
  end if;

  if v_group.kind = 'duel' then
    raise exception 'That code belongs to a one-on-one challenge'
      using errcode = 'check_violation';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

grant execute on function public.create_group_invite(uuid, integer) to authenticated;
grant execute on function public.revoke_group_invite(text) to authenticated;
grant execute on function public.join_group_with_invite(text) to authenticated;
grant execute on function public.join_group_with_code(text) to authenticated;
