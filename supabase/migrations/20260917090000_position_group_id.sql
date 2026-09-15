-- `bet_positions.group_id`, and the two indexes that should always have existed.
--
-- Three separate findings turn out to be the same missing column:
--
--   * SECURITY.md #9 — Realtime subscribes to `bet_positions` **unfiltered**,
--     in both `useGroupRealtime` and `useFeedRealtime`, because there is
--     nothing to filter on. RLS still decides which rows a client may read, so
--     nothing leaks; what leaks is *timing*. Every client learns that somebody,
--     somewhere, just took a side — a metadata side channel, and a small one,
--     but one that exists only because of a schema gap.
--   * SCALEABILITY.md §6 stage 2 — the same gap is the Realtime fan-out wall.
--     `postgres_changes` re-checks RLS per subscriber per change, so an
--     unfiltered subscription makes every position write cost work on every
--     connected client rather than on the handful who can see it.
--   * CLAUDE.md §7.6 — recorded as "fine at friend-group scale, wasteful
--     beyond it".
--
-- It is denormalisation, and it is the right trade: the group is already
-- implied by the bet, and a position can never move between groups because a
-- bet cannot. The column is derived, never supplied.

-- ---------------------------------------------------------------------------
-- 1. The column, nullable for the moment
-- ---------------------------------------------------------------------------
alter table public.bet_positions
  add column if not exists group_id uuid references public.groups (id) on delete cascade;

comment on column public.bet_positions.group_id is
  'Derived from bets.group_id and maintained by a trigger; never supplied by a '
  'client. It exists so Realtime subscriptions can be filtered per group — see '
  'SECURITY.md #9 and SCALEABILITY.md section 6.';

-- ---------------------------------------------------------------------------
-- 2. Keep it filled, and make it impossible to lie about
-- ---------------------------------------------------------------------------
-- A BEFORE trigger that *overwrites* rather than validates. A check constraint
-- or a validating trigger would be a rule a client has to satisfy; this is a
-- rule a client cannot express an opinion about, which is a smaller surface to
-- reason about. It also means no insert site has to change: `join_bet`,
-- `join_bet_option` and the seed scripts all keep naming the columns they
-- always named.
create or replace function public.fill_bet_position_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.group_id := (select b.group_id from public.bets b where b.id = new.bet_id);
  return new;
end;
$$;

comment on function public.fill_bet_position_group() is
  'Fills bet_positions.group_id from the bet, ignoring whatever the writer '
  'supplied. Derived data should not be a thing a client can get wrong.';

-- `before insert or update`, not `update of bet_id`. Narrowing it to the column
-- the value is derived *from* leaves the derived column itself writable, and
-- `bet_positions` has an UPDATE policy so people can switch sides — so a client
-- could have set `group_id` to somebody else's group and had its own position
-- events delivered into that group's filtered subscription. Recomputing on
-- every write costs one indexed lookup and removes the question.
drop trigger if exists bet_positions_fill_group on public.bet_positions;
create trigger bet_positions_fill_group
  before insert or update on public.bet_positions
  for each row execute function public.fill_bet_position_group();

-- ---------------------------------------------------------------------------
-- 3. Backfill
-- ---------------------------------------------------------------------------
-- `bet_positions_require_open` rejects any write to a position on a bet that is
-- locked, resolved, cancelled or past its `close_at` — which is the whole point
-- of it, and which also blocks this backfill on every project with any settled
-- history. Exactly the bug the options migration shipped (CLAUDE.md section 7):
-- against an empty database there is nothing to update and it passes for the
-- wrong reason.
--
-- This is a derived column being filled in, not a position being changed, so
-- the trigger is switched off for the statement and back on afterwards.
alter table public.bet_positions disable trigger bet_positions_require_open;

update public.bet_positions p
   set group_id = b.group_id
  from public.bets b
 where b.id = p.bet_id
   and p.group_id is distinct from b.group_id;

alter table public.bet_positions enable trigger bet_positions_require_open;

-- Every row is derived from a bet that must exist (the foreign key says so), so
-- there is no legitimate way for one to be left null.
alter table public.bet_positions
  alter column group_id set not null;

-- ---------------------------------------------------------------------------
-- 4. The indexes
-- ---------------------------------------------------------------------------
-- SCALEABILITY.md calls `bet_positions (bet_id)` "the highest-value database
-- change in this document", and it is a one-liner: the primary key is
-- (bet_id, user_id), so a lookup by `bet_id` alone can use it — but every bet
-- read in the app embeds `positions:bet_positions(...)`, and PostgREST issues
-- those as a lookup keyed on `bet_id` over the whole table. Only `user_id` had
-- an index of its own.
create index if not exists bet_positions_bet_id_idx
  on public.bet_positions (bet_id);

-- What the filtered subscription and any per-group sweep will read.
create index if not exists bet_positions_group_id_idx
  on public.bet_positions (group_id);

-- The feed reads exactly this pair to decide whether the heart is filled.
-- `bet_likes (bet_id)` already exists; this covers the lookup without a heap
-- fetch.
create index if not exists bet_likes_bet_user_idx
  on public.bet_likes (bet_id, user_id);
