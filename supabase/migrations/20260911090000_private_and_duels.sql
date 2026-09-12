-- Two ways to bet with fewer people: a private bet inside a group, and a
-- one-on-one challenge with somebody you share no group with.
--
-- They look like different features and are the same mechanism twice. Both
-- narrow *who can see a bet*, and both do it without inventing a second
-- visibility system: a duel is a real group with two members that the Groups
-- tab hides, so every policy, balance, settlement and notification path that
-- already works keeps working, unchanged.

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------
-- Needed because a challenge names somebody you may share nothing with, and
-- `users` is only readable by groupmates. A handle is the one piece of you
-- that is safe to be findable.
alter table public.users
  add column if not exists username text;

-- Case-insensitive and unique. Stored as typed, compared folded, so "Dana" and
-- "dana" cannot both exist but the display keeps whichever they chose.
create unique index if not exists users_username_lower_key
  on public.users (lower(username));

alter table public.users
  drop constraint if exists users_username_shape;
alter table public.users
  add constraint users_username_shape check (
    username is null
    or username ~ '^[a-z0-9_][a-z0-9_.]{2,23}$'
  );

-- Picking a handle, in one place.
--
-- Both the backfill below and the signup trigger call this. They were written
-- separately at first and the trigger was simply forgotten, which meant every
-- account created *after* this migration had no handle at all and could not be
-- challenged by anyone — invisible, because the backfill made the existing
-- rows look fine.
create or replace function public.suggest_username(
  p_id uuid,
  p_email text,
  p_display_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(
    split_part(coalesce(nullif(trim(p_email), ''), p_display_name, 'player'), '@', 1),
    '[^a-z0-9_.]', '', 'g'
  ));

  -- The shape check wants 3-24 characters; anything shorter falls back to
  -- something derived from the id rather than being rejected.
  if base is null or char_length(base) < 3 then
    base := 'player' || substr(replace(p_id::text, '-', ''), 1, 6);
  end if;
  base := substr(base, 1, 20);

  candidate := base;
  while exists (select 1 from public.users u where lower(u.username) = candidate) loop
    n := n + 1;
    candidate := substr(base, 1, 20) || n::text;
  end loop;

  return candidate;
end $$;

revoke all on function public.suggest_username(uuid, text, text) from public, anon, authenticated;

-- Everyone who already has an account gets one now.
update public.users
   set username = public.suggest_username(id, email, display_name)
 where username is null;

-- And everyone who signs up from here on gets one as they arrive.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  insert into public.users (id, email, phone, display_name, profile_completed, username)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(v_name, 'Player ' || right(new.id::text, 4)),
    v_name is not null,
    public.suggest_username(new.id, new.email, coalesce(v_name, ''))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Duels: a group of two, hidden from the Groups tab
-- ---------------------------------------------------------------------------
alter table public.groups
  add column if not exists kind text not null default 'group'
    check (kind in ('group', 'duel'));

comment on column public.groups.kind is
  'A duel is a two-person group created by a challenge. Hidden from the Groups tab; its bets still appear in the feed and its balances still settle.';

-- ---------------------------------------------------------------------------
-- Private bets
-- ---------------------------------------------------------------------------
alter table public.bets
  add column if not exists visibility text not null default 'group'
    check (visibility in ('group', 'private'));

create table if not exists public.bet_invitees (
  bet_id uuid not null references public.bets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  primary key (bet_id, user_id)
);

create index if not exists bet_invitees_user_idx on public.bet_invitees (user_id);

-- ---------------------------------------------------------------------------
-- One helper, and everything hangs off it
-- ---------------------------------------------------------------------------
-- `is_group_member(bet_group_id(id))` was the rule for a bet and for every
-- table that points at one. It is now `can_see_bet(id)`, which is that rule
-- plus the invitee list. Keeping it in one function is the whole point: a
-- private bet whose comments were readable, or whose options leaked its
-- options, would be private in name only.
create or replace function public.can_see_bet(p_bet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bets b
    where b.id = p_bet_id
      and public.is_group_member(b.group_id)
      and (
        b.visibility = 'group'
        or b.creator_id = auth.uid()
        or exists (
          select 1 from public.bet_invitees i
          where i.bet_id = b.id and i.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.can_see_bet(uuid) to authenticated;

-- Every policy that guarded a bet or something attached to one.
drop policy if exists bets_select_members on public.bets;
create policy bets_select_members on public.bets
  for select
  using (public.can_see_bet(id));

drop policy if exists bet_positions_select_members on public.bet_positions;
create policy bet_positions_select_members on public.bet_positions
  for select
  using (public.can_see_bet(bet_id));

drop policy if exists bet_positions_insert_self on public.bet_positions;
create policy bet_positions_insert_self on public.bet_positions
  for insert
  with check (user_id = auth.uid() and public.can_see_bet(bet_id));

drop policy if exists bet_options_select_members on public.bet_options;
create policy bet_options_select_members on public.bet_options
  for select
  using (public.can_see_bet(bet_id));

drop policy if exists bet_media_select_members on public.bet_media;
create policy bet_media_select_members on public.bet_media
  for select
  using (public.can_see_bet(bet_id));

drop policy if exists bet_likes_select_members on public.bet_likes;
create policy bet_likes_select_members on public.bet_likes
  for select
  using (public.can_see_bet(bet_id));

drop policy if exists bet_likes_insert_self on public.bet_likes;
create policy bet_likes_insert_self on public.bet_likes
  for insert
  with check (user_id = auth.uid() and public.can_see_bet(bet_id));

drop policy if exists bet_comments_select_members on public.bet_comments;
create policy bet_comments_select_members on public.bet_comments
  for select
  using (public.can_see_bet(bet_id));

drop policy if exists bet_comments_insert_self on public.bet_comments;
create policy bet_comments_insert_self on public.bet_comments
  for insert
  with check (user_id = auth.uid() and public.can_see_bet(bet_id));

-- The invitee list is visible to the people on it and to the creator, and
-- written only by the creator while the bet is open — the same window in which
-- options and media can be attached.
alter table public.bet_invitees enable row level security;

create policy bet_invitees_select_visible on public.bet_invitees
  for select
  using (public.can_see_bet(bet_id));

create policy bet_invitees_insert_creator on public.bet_invitees
  for insert
  with check (
    exists (
      select 1 from public.bets b
      where b.id = bet_id
        and b.creator_id = auth.uid()
        and b.status = 'open'
        and public.is_group_member(b.group_id)
    )
    -- You can only invite somebody who is actually in the group. A private bet
    -- narrows an audience; it never reaches outside one.
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = public.bet_group_id(bet_id)
        and gm.user_id = bet_invitees.user_id
    )
  );

alter publication supabase_realtime add table public.bet_invitees;

-- ---------------------------------------------------------------------------
-- Finding somebody, and challenging them
-- ---------------------------------------------------------------------------
-- Exact match only, and deliberately not a search. A prefix or fuzzy lookup
-- over this table is a user-enumeration endpoint: anyone could walk it and
-- harvest the whole user list. You have to already know the handle.
create or replace function public.find_user_by_username(p_username text)
returns table (id uuid, display_name text, username text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.display_name, u.username, u.avatar_url
  from public.users u
  where lower(u.username) = lower(trim(p_username))
    and u.id <> auth.uid()
  limit 1;
$$;

grant execute on function public.find_user_by_username(text) to authenticated;

-- Start (or reuse) a duel with somebody. Returns the group their bets live in.
--
-- Reuse matters: challenging the same person twice must land in the same
-- two-person group, or their running total with you fragments across a dozen
-- identical groups and the Profile ledger stops meaning anything.
create or replace function public.create_duel(p_username text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_them uuid;
  v_group public.groups;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select id into v_them from public.find_user_by_username(p_username);
  if v_them is null then
    raise exception 'No one is using that username' using errcode = 'no_data_found';
  end if;

  -- An existing duel between exactly these two, if there is one.
  select g.* into v_group
  from public.groups g
  where g.kind = 'duel'
    and (select count(*) from public.group_members m where m.group_id = g.id) = 2
    and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_me)
    and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_them)
  limit 1;

  if found then
    return v_group;
  end if;

  insert into public.groups (name, emoji, kind, created_by, invite_code)
  values (
    -- Named from the pair so anything that renders a group name has something
    -- to show; the app substitutes the other person's name where it can.
    (select display_name from public.users where id = v_me) || ' v ' ||
    (select display_name from public.users where id = v_them),
    '⚔️',
    'duel',
    v_me,
    public.generate_invite_code()
  )
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, v_me, 'admin'), (v_group.id, v_them, 'member');

  return v_group;
end $$;

grant execute on function public.create_duel(text) to authenticated;
