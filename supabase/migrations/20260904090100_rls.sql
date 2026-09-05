-- Row Level Security for Lotus Bet.
--
-- The rule everywhere is the same: you can only see rows belonging to a group
-- you are a member of. Membership is checked through a SECURITY DEFINER helper
-- so that policies on `group_members` do not recurse into themselves.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'admin'
  );
$$;

-- True when the signed-in user shares at least one group with p_user_id.
create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

create or replace function public.bet_group_id(p_bet_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.group_id from public.bets b where b.id = p_bet_id;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

create policy users_select_self_or_groupmates on public.users
  for select
  using (id = auth.uid() or public.shares_group_with(id));

create policy users_insert_self on public.users
  for insert
  with check (id = auth.uid());

create policy users_update_self on public.users
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
alter table public.groups enable row level security;

create policy groups_select_members on public.groups
  for select
  using (public.is_group_member(id));

-- Groups are normally created through `create_group()`, which also inserts the
-- creator's admin membership. Direct inserts are still restricted to yourself.
create policy groups_insert_self on public.groups
  for insert
  with check (created_by = auth.uid());

create policy groups_update_admin on public.groups
  for update
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------
alter table public.group_members enable row level security;

create policy group_members_select_members on public.group_members
  for select
  using (public.is_group_member(group_id));

-- Joining happens through `join_group_with_code()`; this covers the creator's
-- own first membership row and lets a user leave a group.
create policy group_members_insert_self on public.group_members
  for insert
  with check (user_id = auth.uid());

create policy group_members_delete_self_or_admin on public.group_members
  for delete
  using (user_id = auth.uid() or public.is_group_admin(group_id));

-- ---------------------------------------------------------------------------
-- bets
-- ---------------------------------------------------------------------------
alter table public.bets enable row level security;

create policy bets_select_members on public.bets
  for select
  using (public.is_group_member(group_id));

create policy bets_insert_members on public.bets
  for insert
  with check (creator_id = auth.uid() and public.is_group_member(group_id));

-- Only the creator may change a bet, and only ever to lock, resolve or cancel
-- it — never to edit its terms. `lock_bet` / `cancel_bet` / the resolve-bet
-- Edge Function are the supported paths; this policy is the backstop.
create policy bets_update_creator on public.bets
  for update
  using (creator_id = auth.uid() and public.is_group_member(group_id))
  with check (creator_id = auth.uid());

-- ---------------------------------------------------------------------------
-- bet_positions
-- ---------------------------------------------------------------------------
alter table public.bet_positions enable row level security;

create policy bet_positions_select_members on public.bet_positions
  for select
  using (public.is_group_member(public.bet_group_id(bet_id)));

-- Writes go through `join_bet()` / `leave_bet()`, which enforce the open/locked
-- rules. These policies keep a direct client write honest about *whose* row it
-- is; the status rules are re-checked by triggers below.
create policy bet_positions_insert_self on public.bet_positions
  for insert
  with check (
    user_id = auth.uid()
    and public.is_group_member(public.bet_group_id(bet_id))
  );

create policy bet_positions_update_self on public.bet_positions
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy bet_positions_delete_self on public.bet_positions
  for delete
  using (user_id = auth.uid());

-- A position may only be created, switched or withdrawn while the bet is open
-- and before its close time. Enforced as a trigger so it holds no matter which
-- path wrote the row.
create or replace function public.enforce_bet_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.bets;
  v_row public.bet_positions;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select * into v_bet from public.bets where id = v_row.bet_id;

  if v_bet.status <> 'open' then
    raise exception 'Bet is % — positions can no longer change', v_bet.status
      using errcode = 'check_violation';
  end if;

  if v_bet.close_at is not null and v_bet.close_at <= now() then
    raise exception 'Bet closed for joining at %', v_bet.close_at
      using errcode = 'check_violation';
  end if;

  return v_row;
end;
$$;

create trigger bet_positions_require_open
  before insert or update or delete on public.bet_positions
  for each row execute function public.enforce_bet_open();

-- ---------------------------------------------------------------------------
-- bet_ledger_entries
-- ---------------------------------------------------------------------------
alter table public.bet_ledger_entries enable row level security;

-- Read-only for clients. Rows are written exclusively by the resolve-bet Edge
-- Function using the service role, which bypasses RLS.
create policy bet_ledger_entries_select_members on public.bet_ledger_entries
  for select
  using (public.is_group_member(group_id));

-- ---------------------------------------------------------------------------
-- settlement_confirmations
-- ---------------------------------------------------------------------------
alter table public.settlement_confirmations enable row level security;

create policy settlement_confirmations_select_members on public.settlement_confirmations
  for select
  using (public.is_group_member(group_id));

-- Either side of a payment may confirm it, and only for a group they belong to.
create policy settlement_confirmations_insert_participant on public.settlement_confirmations
  for insert
  with check (
    confirmed_by = auth.uid()
    and public.is_group_member(group_id)
    and auth.uid() in (from_user_id, to_user_id)
  );

create policy settlement_confirmations_delete_participant on public.settlement_confirmations
  for delete
  using (
    public.is_group_member(group_id)
    and auth.uid() in (from_user_id, to_user_id)
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- One channel per group in the client; these publications make the underlying
-- table changes visible to it.
alter publication supabase_realtime add table public.bets;
alter publication supabase_realtime add table public.bet_positions;
alter publication supabase_realtime add table public.bet_ledger_entries;
alter publication supabase_realtime add table public.settlement_confirmations;
