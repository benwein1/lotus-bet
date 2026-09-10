-- Likes, comments, and one read that returns every balance at once.
--
-- Nothing here changes who can see a bet: both new tables reuse
-- `bet_group_id` + `is_group_member`, which is the same rule the bet itself is
-- protected by. A reaction must never be visible where the thing it reacts to
-- is not.

-- ---------------------------------------------------------------------------
-- Likes
-- ---------------------------------------------------------------------------
-- One row per person per bet; the primary key is the "only once" rule, so an
-- enthusiastic double-tap cannot inflate a count.
create table if not exists public.bet_likes (
  bet_id uuid not null references public.bets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (bet_id, user_id)
);

create index if not exists bet_likes_bet_idx on public.bet_likes (bet_id);

alter table public.bet_likes enable row level security;

create policy bet_likes_select_members on public.bet_likes
  for select
  using (public.is_group_member(public.bet_group_id(bet_id)));

-- You may only like as yourself, and only where you can see the bet.
create policy bet_likes_insert_self on public.bet_likes
  for insert
  with check (
    user_id = auth.uid()
    and public.is_group_member(public.bet_group_id(bet_id))
  );

create policy bet_likes_delete_self on public.bet_likes
  for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create table if not exists public.bet_comments (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists bet_comments_bet_created_idx
  on public.bet_comments (bet_id, created_at);

alter table public.bet_comments enable row level security;

create policy bet_comments_select_members on public.bet_comments
  for select
  using (public.is_group_member(public.bet_group_id(bet_id)));

create policy bet_comments_insert_self on public.bet_comments
  for insert
  with check (
    user_id = auth.uid()
    and public.is_group_member(public.bet_group_id(bet_id))
  );

-- Deliberately no UPDATE policy: a comment cannot be edited, only withdrawn.
-- An editable comment on a bet somebody wagered against is a way to rewrite
-- what was agreed after the fact.
create policy bet_comments_delete_self on public.bet_comments
  for delete
  using (user_id = auth.uid());

-- Both tables ride the existing Realtime publication so a like or a comment
-- lands on everyone's screen the way a new position already does.
alter publication supabase_realtime add table public.bet_likes;
alter publication supabase_realtime add table public.bet_comments;

-- ---------------------------------------------------------------------------
-- Every balance in one call
-- ---------------------------------------------------------------------------
-- The Profile ledger needs "what am I owed, and by whom" across every group,
-- and the honest answer to that is whatever the settle-up screen would tell
-- you to pay. So this deliberately does **not** compute who-owes-whom: it
-- returns the same per-group balances `group_balances` returns, for all of
-- your groups at once, and the client runs the same `simplifyDebts` the settle
-- screen runs.
--
-- Netting it here in SQL instead would be a second implementation of the one
-- thing that decides what a person hands over, and the two would eventually
-- disagree. Same reasoning as the payout module: one implementation, used
-- everywhere.
create or replace function public.my_group_balances()
returns table (group_id uuid, user_id uuid, amount_agorot bigint)
language sql
stable
security definer
set search_path = public
as $$
  with my_groups as (
    select gm.group_id
    from public.group_members gm
    where gm.user_id = auth.uid()
  ),
  movements as (
    select e.group_id, e.user_id, e.amount_agorot::bigint as amount
    from public.bet_ledger_entries e
    where e.group_id in (select group_id from my_groups)

    union all

    -- Paying someone moves you towards zero from below.
    select s.group_id, s.from_user_id, s.amount_agorot::bigint
    from public.settlement_confirmations s
    where s.group_id in (select group_id from my_groups)

    union all

    select s.group_id, s.to_user_id, -s.amount_agorot::bigint
    from public.settlement_confirmations s
    where s.group_id in (select group_id from my_groups)
  )
  select gm.group_id, gm.user_id, coalesce(sum(mv.amount), 0)::bigint
  from public.group_members gm
  join my_groups g on g.group_id = gm.group_id
  left join movements mv
    on mv.group_id = gm.group_id and mv.user_id = gm.user_id
  group by gm.group_id, gm.user_id;
$$;

revoke execute on function public.my_group_balances() from public, anon;
grant execute on function public.my_group_balances() to authenticated;
