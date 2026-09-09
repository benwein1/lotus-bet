-- Bets with more than two options, and a resolution that cannot half-happen.
--
-- Two changes that belong together, because the second is defined in terms of
-- the first.
--
-- 1. `bet_options` replaces the `option_a_label` / `option_b_label` pair. The
--    original schema was shaped for this: the comment on those columns said a
--    `bet_options` table would supersede them. `bet_positions.option_id` and
--    `bets.winning_option_id` point at rows here.
--
--    The payout rule does not change and is not re-derived anywhere: everyone
--    on the winning option shares the pot, and *everyone else together* covers
--    it. One pot, not one pot per losing option. That is the two-option rule
--    with the number two removed from it.
--
-- 2. `resolve_bet_with_entries` writes the ledger and flips the bet in a
--    single transaction.
--
--    Resolution used to be an Edge Function that inserted the ledger rows and
--    *then* updated the bet. A crash between the two left the rows written and
--    the bet still open; the retry hit the (bet_id, user_id) unique index and
--    threw, so the bet could never be resolved, settled or cancelled. It also
--    meant resolving anything at all required a deployed Edge Function, and
--    without one the app reported "Failed to send a request to the Edge
--    Function" and there was no way past it.
--
--    The maths stays in TypeScript — `supabase/functions/_shared/payout.ts` is
--    still the only implementation of it, and this function does not attempt a
--    second one. What it does instead is refuse to write a set of entries that
--    breaks the invariants the maths guarantees: see the checks below.

-- ---------------------------------------------------------------------------
-- Options
-- ---------------------------------------------------------------------------
create table if not exists public.bet_options (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  -- Display order, and what "option 1" means when reading a notification.
  position smallint not null check (position >= 0),
  label text not null check (char_length(trim(label)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (bet_id, position)
);

create index if not exists bet_options_bet_id_idx on public.bet_options (bet_id, position);

alter table public.bets
  add column if not exists winning_option_id uuid references public.bet_options (id);

alter table public.bet_positions
  add column if not exists option_id uuid references public.bet_options (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Backfill every existing bet into the new shape
-- ---------------------------------------------------------------------------
-- Two options each, from the label columns, in the order they were displayed.
insert into public.bet_options (bet_id, position, label)
select b.id, 0, b.option_a_label
from public.bets b
where not exists (select 1 from public.bet_options o where o.bet_id = b.id and o.position = 0);

insert into public.bet_options (bet_id, position, label)
select b.id, 1, b.option_b_label
from public.bets b
where not exists (select 1 from public.bet_options o where o.bet_id = b.id and o.position = 1);

-- `bet_positions_require_open` rejects any write to a position on a bet that
-- is locked, resolved, cancelled or past its close time — which is the whole
-- point of it, and which also blocks this backfill. Every position on every
-- settled bet in the table is exactly the kind of row it is there to protect.
--
-- So the trigger comes off for the length of the backfill and goes straight
-- back on. This is a column being filled in, not a position being changed:
-- the side each row already recorded is what decides its option, and no row
-- ends up pointing anywhere different from where it pointed before.
alter table public.bet_positions disable trigger bet_positions_require_open;

update public.bet_positions p
   set option_id = o.id
  from public.bet_options o
 where o.bet_id = p.bet_id
   and o.position = case p.side when 'a' then 0 else 1 end
   and p.option_id is null;

alter table public.bet_positions enable trigger bet_positions_require_open;

update public.bets b
   set winning_option_id = o.id
  from public.bet_options o
 where o.bet_id = b.id
   and o.position = case b.winning_option when 'a' then 0 else 1 end
   and b.winning_option is not null
   and b.winning_option_id is null;

-- Every position now points at an option, so it can be required from here on.
alter table public.bet_positions
  alter column option_id set not null;

-- `side` stays, nullable, and is written alongside `option_id` for the first
-- two options only. Nothing reads it any more; it is kept so that a client
-- built before this migration keeps working against the same rows rather than
-- seeing nulls it cannot interpret.
alter table public.bet_positions
  alter column side drop not null;

-- ---------------------------------------------------------------------------
-- The resolved-status constraints, restated in terms of options
-- ---------------------------------------------------------------------------
-- The old pair keyed off `winning_option`, which can only ever say 'a' or 'b'
-- and therefore cannot describe a third option winning.
alter table public.bets drop constraint if exists bets_winner_matches_status;
alter table public.bets drop constraint if exists bets_resolved_requires_timestamp;

alter table public.bets
  add constraint bets_winner_matches_status check (
    (status = 'resolved') = (winning_option_id is not null)
  );

alter table public.bets
  add constraint bets_resolved_requires_timestamp check (
    (status = 'resolved') = (resolved_at is not null)
  );

-- Every bet gets its first two options automatically, from the label columns.
--
-- `option_a_label` and `option_b_label` are NOT NULL and always will be, so
-- the first two options can always be derived. Deriving them rather than
-- asking the client for them means a bet inserted by *anything* — an old build
-- of the app, the seed script, a row typed into the SQL editor — is a valid
-- bet with options, instead of one that nobody can join.
--
-- A client posting a bet with more than two options writes its first two into
-- the label columns as usual and inserts positions 2 upward itself, so the two
-- paths meet rather than collide.
create or replace function public.seed_bet_options()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bet_options (bet_id, position, label)
  values (new.id, 0, new.option_a_label), (new.id, 1, new.option_b_label)
  on conflict (bet_id, position) do nothing;
  return new;
end;
$$;

drop trigger if exists bets_seed_options on public.bets;
create trigger bets_seed_options
  after insert on public.bets
  for each row execute function public.seed_bet_options();

-- Fill `option_id` from `side` for any writer that only knows about sides.
--
-- Every path in the app goes through `join_bet_option`, which sets it. This is
-- for everything else: the seed script, a hand-written insert in the SQL
-- editor, a psql session during a migration. Without it those all fail on the
-- NOT NULL, which is a confusing way to learn that the schema moved on.
create or replace function public.fill_bet_position_option()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.option_id is null and new.side is not null then
    select id into new.option_id
      from public.bet_options
     where bet_id = new.bet_id
       and position = case new.side when 'a' then 0 else 1 end;
  end if;

  -- And the other way, so `side` stays meaningful for the first two options.
  if new.side is null and new.option_id is not null then
    select case position when 0 then 'a' when 1 then 'b' else null end
      into new.side
      from public.bet_options
     where id = new.option_id;
  end if;

  return new;
end;
$$;

drop trigger if exists bet_positions_fill_option on public.bet_positions;
create trigger bet_positions_fill_option
  before insert or update on public.bet_positions
  for each row execute function public.fill_bet_position_option();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.bet_options enable row level security;

drop policy if exists bet_options_select_members on public.bet_options;
create policy bet_options_select_members on public.bet_options
  for select
  using (public.is_group_member(public.bet_group_id(bet_id)));

-- Options are written once, by the creator, while the bet is still open. There
-- is deliberately no update or delete policy: a bet cannot be edited after
-- creation, and changing an option out from under someone who backed it would
-- be exactly that.
drop policy if exists bet_options_insert_creator on public.bet_options;
create policy bet_options_insert_creator on public.bet_options
  for insert
  with check (
    exists (
      select 1 from public.bets b
      where b.id = bet_id
        and b.creator_id = auth.uid()
        and b.status = 'open'
    )
  );

alter publication supabase_realtime add table public.bet_options;

-- ---------------------------------------------------------------------------
-- Joining an option
-- ---------------------------------------------------------------------------
create or replace function public.join_bet_option(p_bet_id uuid, p_option_id uuid)
returns public.bet_positions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.bets;
  v_row public.bet_positions;
  v_position smallint;
begin
  select * into v_bet from public.bets where id = p_bet_id;
  if v_bet is null then
    raise exception 'Bet not found';
  end if;
  if not public.is_group_member(v_bet.group_id) then
    raise exception 'You are not in that group';
  end if;

  select position into v_position
    from public.bet_options
   where id = p_option_id and bet_id = p_bet_id;

  if v_position is null then
    raise exception 'That option does not belong to this bet';
  end if;

  -- `side` is written for the first two options so that rows stay readable to
  -- a client built before options existed. Beyond two there is no letter to
  -- write, and that is fine: nothing reads it.
  insert into public.bet_positions (bet_id, user_id, option_id, side)
  values (
    p_bet_id,
    auth.uid(),
    p_option_id,
    case v_position when 0 then 'a' when 1 then 'b' else null end
  )
  on conflict (bet_id, user_id) do update
    set option_id = excluded.option_id,
        side = excluded.side,
        joined_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- The old two-outcome entry point, kept working.
--
-- `option_id` is NOT NULL now, so the original `join_bet` would fail on every
-- call — including from a copy of the app built before this migration, which
-- is exactly the thing that must not break during a rollout. It resolves the
-- letter to the option in position 0 or 1 and delegates.
create or replace function public.join_bet(p_bet_id uuid, p_side text)
returns public.bet_positions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if p_side not in ('a', 'b') then
    raise exception 'Side must be a or b' using errcode = 'check_violation';
  end if;

  select id into v_option_id
    from public.bet_options
   where bet_id = p_bet_id
     and position = case p_side when 'a' then 0 else 1 end;

  if v_option_id is null then
    raise exception 'Bet not found' using errcode = 'no_data_found';
  end if;

  return public.join_bet_option(p_bet_id, v_option_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolution, in one transaction
-- ---------------------------------------------------------------------------
-- `p_entries` is `[{ "user_id": uuid, "amount_agorot": int }, ...]`, computed
-- by `computeBetPayouts`. This function does not recompute it — it checks that
-- what it was handed has the properties that function guarantees, and refuses
-- the write otherwise:
--
--   * one entry per participant, no duplicates, nobody who did not play
--   * everyone on the winning option is owed something, everyone else owes
--   * the credits total exactly the pot, and so do the debits
--   * therefore the whole set nets to zero
--
-- Those pin both totals exactly, so no amount of tampering can create money,
-- move it out of the group, or bill somebody who was not in the bet. What they
-- do not pin is how a side's total is divided within itself, which is the one
-- thing left resting on the client — and the creator, who is the only caller,
-- already decides who won.
create or replace function public.resolve_bet_with_entries(
  p_bet_id uuid,
  p_winning_option_id uuid,
  p_entries jsonb
)
returns public.bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.bets;
  v_participants int;
  v_entries int;
  v_credits bigint;
  v_debits bigint;
  v_mismatched int;
  v_resolved public.bets;
begin
  select * into v_bet from public.bets where id = p_bet_id for update;

  if v_bet is null then
    raise exception 'Bet not found';
  end if;
  if v_bet.creator_id <> auth.uid() then
    raise exception 'Only the bet creator can resolve it';
  end if;
  if v_bet.status = 'resolved' then
    raise exception 'Bet is already resolved';
  end if;
  if v_bet.status = 'cancelled' then
    raise exception 'Bet was cancelled';
  end if;
  if not exists (
    select 1 from public.bet_options
     where id = p_winning_option_id and bet_id = p_bet_id
  ) then
    raise exception 'That option does not belong to this bet';
  end if;

  select count(*) into v_participants from public.bet_positions where bet_id = p_bet_id;

  with entry as (
    select
      (e ->> 'user_id')::uuid   as user_id,
      (e ->> 'amount_agorot')::bigint as amount
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as e
  )
  select
    count(*),
    coalesce(sum(amount) filter (where amount > 0), 0),
    coalesce(sum(amount) filter (where amount < 0), 0),
    count(*) filter (
      where not exists (
        select 1 from public.bet_positions p
         where p.bet_id = p_bet_id
           and p.user_id = entry.user_id
           and ((p.option_id = p_winning_option_id) = (entry.amount > 0))
      )
    )
  into v_entries, v_credits, v_debits, v_mismatched
  from entry;

  if v_entries = 0 then
    -- The no-movement case: legitimate only when one side of the bet is empty.
    if exists (
      select 1 from public.bet_positions where bet_id = p_bet_id and option_id = p_winning_option_id
    ) and exists (
      select 1 from public.bet_positions where bet_id = p_bet_id and option_id <> p_winning_option_id
    ) then
      raise exception 'Refusing to resolve with no ledger entries when both sides were backed';
    end if;
  else
    if v_entries <> v_participants then
      raise exception 'Ledger must have exactly one entry per participant (% entries, % participants)',
        v_entries, v_participants;
    end if;
    if exists (
      select (e ->> 'user_id')::uuid
      from jsonb_array_elements(p_entries) as e
      group by 1 having count(*) > 1
    ) then
      raise exception 'Ledger has more than one entry for the same person';
    end if;
    if v_mismatched > 0 then
      raise exception 'Ledger pays somebody who did not win, or bills somebody who did';
    end if;
    if v_credits <> v_bet.total_pot_agorot then
      raise exception 'Credits must total the pot (got %, pot %)', v_credits, v_bet.total_pot_agorot;
    end if;
    if v_debits <> -v_bet.total_pot_agorot then
      raise exception 'Debits must total the pot (got %, pot %)', v_debits, -v_bet.total_pot_agorot;
    end if;

    insert into public.bet_ledger_entries (bet_id, group_id, user_id, amount_agorot)
    select p_bet_id, v_bet.group_id, (e ->> 'user_id')::uuid, (e ->> 'amount_agorot')::int
    from jsonb_array_elements(p_entries) as e;
  end if;

  update public.bets
     set status = 'resolved',
         winning_option_id = p_winning_option_id,
         winning_option = (
           select case position when 0 then 'a' when 1 then 'b' else null end
           from public.bet_options where id = p_winning_option_id
         ),
         resolved_at = now()
   where id = p_bet_id
  returning * into v_resolved;

  return v_resolved;
end;
$$;

revoke all on function public.resolve_bet_with_entries(uuid, uuid, jsonb) from public;
grant execute on function public.resolve_bet_with_entries(uuid, uuid, jsonb) to authenticated;
grant execute on function public.join_bet_option(uuid, uuid) to authenticated;

grant select on public.bet_options to anon, authenticated;
grant insert on public.bet_options to authenticated;
