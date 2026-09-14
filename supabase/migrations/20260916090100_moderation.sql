-- Reporting and blocking.
--
-- App Store Review Guideline 1.2 asks four things of any app carrying
-- user-generated content, and this app is squarely one: comments, display
-- names, group names, bet titles, and user-uploaded photos and video. The four
-- are a method for filtering objectionable material, a way to report offensive
-- content with a timely response, a way to block abusive users, and published
-- contact information. None of them existed. Two of them are schema, and this
-- is that schema.
--
-- The shape is deliberately small. There are no severity levels, no report
-- categories beyond a short fixed list, no appeals table and no moderator
-- role — because a friend-group betting app's realistic moderation load is a
-- handful of reports, read by one person. What the schema does have to get
-- right is who may write what, and what a block actually means.

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
-- A block is **mutual invisibility**, not a mute. Blocking somebody has to
-- stop their comments reaching you *and* stop yours reaching them, or a block
-- becomes a way to talk about someone who cannot answer.
--
-- It is not a membership change: you stay in the group, they stay in the
-- group, and the ledger between you is untouched. This app records who owes
-- whom, and a debt does not disappear because two people stopped speaking —
-- making a block erase balances would turn it into a way to escape one.
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- You can see the blocks you made. You cannot see who has blocked you — being
-- told would turn a quiet exit into a confrontation, which is the thing the
-- feature exists to avoid.
create policy user_blocks_select_own on public.user_blocks
  for select
  using (blocker_id = auth.uid());

create policy user_blocks_insert_own on public.user_blocks
  for insert
  with check (blocker_id = auth.uid());

create policy user_blocks_delete_own on public.user_blocks
  for delete
  using (blocker_id = auth.uid());

-- No UPDATE policy: a block is created or removed, never edited.

-- ---------------------------------------------------------------------------
-- The block predicate
-- ---------------------------------------------------------------------------
-- `SECURITY DEFINER` for the same reason `is_group_member` is: a policy on a
-- table that queries `user_blocks` directly would be evaluated against that
-- table's own policies, and the one above restricts the rows to
-- `blocker_id = auth.uid()` — so the *other* direction of the block would be
-- invisible to the check and half of "mutual" would silently not happen.
--
-- Symmetric on purpose: true if either of you blocked the other.
create or replace function public.is_blocked_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_user_id)
       or (b.blocker_id = p_user_id and b.blocked_id = auth.uid())
  );
$$;

grant execute on function public.is_blocked_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Blocks apply to comments, at the policy level
-- ---------------------------------------------------------------------------
-- Filtering in the client would be a display preference, not a boundary: the
-- rows would still be on the device, and the next screen that forgets to
-- filter re-exposes them. Doing it here means a blocked person's comments do
-- not exist as far as the API is concerned.
--
-- Your own comments are exempt from the check so that a thread you took part
-- in before the block still reads as yours.
drop policy if exists bet_comments_select_members on public.bet_comments;
create policy bet_comments_select_members on public.bet_comments
  for select
  using (
    public.can_see_bet(bet_id)
    and (user_id = auth.uid() or not public.is_blocked_with(user_id))
  );

-- Likes are a count, and a count with a hole in it invites the question of
-- who is missing. Left alone deliberately.

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
-- One table for all three targets rather than three tables, because the thing
-- being recorded is identical in each case — who complained, about what, why,
-- and has anyone dealt with it. The target is a kind plus an id, with the
-- reported person carried separately so a moderator can see a pattern across
-- one account without joining through three tables.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id) on delete cascade,

  target_kind text not null check (target_kind in ('comment', 'bet', 'user')),
  -- Not a foreign key: it points at one of three tables depending on
  -- `target_kind`, and a constraint cannot follow that. It is also the reason
  -- reports survive their target being deleted — which is the case a moderator
  -- most needs to see, since deleting the evidence is the obvious first move.
  target_id uuid not null,

  -- Who the complaint is *about*. Null only when the target has been deleted
  -- and the author could not be resolved.
  reported_user_id uuid references public.users (id) on delete set null,

  -- A short fixed list, not free text. Free text on a report form is an abuse
  -- vector in its own right — it is a message box aimed at whoever reads the
  -- queue, from someone who is already angry.
  reason text not null check (
    reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'other')
  ),

  status text not null default 'open'
    check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),

  -- One open report per person per thing. A second tap on Report should be a
  -- no-op, not a second row, or one determined user can bury the queue.
  unique (reporter_id, target_kind, target_id)
);

create index if not exists reports_open_idx
  on public.reports (status, created_at)
  where status = 'open';

create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id);

alter table public.reports enable row level security;

-- You may file a report and read back the ones you filed — enough for the UI
-- to say "you already reported this" without a second round trip.
--
-- You may **not** read anyone else's, and there is no UPDATE or DELETE policy
-- at all: a reporter cannot withdraw a report and cannot mark their own
-- complaint resolved. Triage happens through the service role, outside the
-- client. That is what makes the queue trustworthy.
create policy reports_select_own on public.reports
  for select
  using (reporter_id = auth.uid());

create policy reports_insert_own on public.reports
  for insert
  with check (
    reporter_id = auth.uid()
    and reported_user_id is distinct from auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Filing one
-- ---------------------------------------------------------------------------
-- An RPC rather than a plain insert, for three reasons that all have to hold
-- together: the reported user has to be resolved from the target (the client
-- naming them would let anyone file a report against anybody), the reporter
-- has to be able to see the thing they are reporting (otherwise the report
-- endpoint is an oracle for whether a private bet exists), and a repeat tap
-- has to be idempotent.
create or replace function public.report_content(
  p_target_kind text,
  p_target_id uuid,
  p_reason text
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_reported uuid;
  v_row public.reports;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_target_kind = 'comment' then
    select c.user_id into v_reported
    from public.bet_comments c
    where c.id = p_target_id and public.can_see_bet(c.bet_id);
  elsif p_target_kind = 'bet' then
    select b.creator_id into v_reported
    from public.bets b
    where b.id = p_target_id and public.can_see_bet(b.id);
  elsif p_target_kind = 'user' then
    select u.id into v_reported
    from public.users u
    where u.id = p_target_id and public.shares_group_with(u.id);
  else
    raise exception 'Unknown report target %', p_target_kind
      using errcode = 'invalid_parameter_value';
  end if;

  -- Deliberately the same error whether the thing does not exist or is simply
  -- not visible to this caller. Telling them apart is what turns this into a
  -- probe for other people's private bets.
  if v_reported is null then
    raise exception 'Nothing to report' using errcode = 'no_data_found';
  end if;

  if v_reported = v_me then
    raise exception 'You cannot report yourself'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.reports
    (reporter_id, target_kind, target_id, reported_user_id, reason)
  values (v_me, p_target_kind, p_target_id, v_reported, p_reason)
  on conflict (reporter_id, target_kind, target_id) do nothing
  returning * into v_row;

  -- `do nothing` returns no row when it collided, which is the repeat tap.
  -- Hand back the report that already exists so the caller sees success.
  if v_row.id is null then
    select * into v_row
    from public.reports
    where reporter_id = v_me
      and target_kind = p_target_kind
      and target_id = p_target_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.report_content(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Blocking somebody
-- ---------------------------------------------------------------------------
-- Also an RPC, so that "you can only block someone you share a group with"
-- lives next to the rule that you can only see someone you share a group with.
-- Without it, the blocks table is a place to write arbitrary user ids and
-- confirm which ones exist.
create or replace function public.block_user(p_user_id uuid)
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

  if p_user_id = v_me then
    raise exception 'You cannot block yourself'
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.shares_group_with(p_user_id) then
    raise exception 'Nothing to block' using errcode = 'no_data_found';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_user_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_blocks
  where blocker_id = auth.uid() and blocked_id = p_user_id;
$$;

grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who you have blocked
-- ---------------------------------------------------------------------------
-- The Profile screen lists them so a block can be undone. It returns names
-- rather than bare ids because `users` is column-restricted now and this is
-- the one place the client needs to render a person it may no longer share a
-- group with — unblocking has to stay possible after leaving a group together.
create or replace function public.my_blocked_users()
returns table (id uuid, display_name text, username text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.display_name, u.username, u.avatar_url
  from public.user_blocks b
  join public.users u on u.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by u.display_name;
$$;

grant execute on function public.my_blocked_users() to authenticated;
