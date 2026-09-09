-- Lotus Bet — initial schema.
--
-- Money is stored everywhere as integer agorot (1 ILS = 100 agorot). The app
-- never moves real money: these tables only record who owes whom so friends
-- can settle up themselves, offline.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
-- `id` mirrors `auth.users.id` so every RLS policy can compare against
-- `auth.uid()` directly. The row is created by a trigger on signup and then
-- completed by the user on the profile-setup screen.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text unique not null,
  display_name text not null,
  avatar_url text,
  expo_push_token text,
  notify_new_bets boolean not null default true,
  notify_resolutions boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  emoji text, -- simple visual identity instead of photo upload for MVP
  created_by uuid not null references public.users (id),
  invite_code text unique not null,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- Bets
-- ---------------------------------------------------------------------------
-- Two-outcome only for the MVP. The option columns are deliberately shaped so
-- a future `bet_options` table can supersede them without rewriting anything
-- that reads bets today.
create table public.bets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  creator_id uuid not null references public.users (id),
  title text not null check (char_length(trim(title)) between 1 and 140),
  description text check (char_length(description) <= 500),
  option_a_label text not null check (char_length(trim(option_a_label)) between 1 and 40),
  option_b_label text not null check (char_length(trim(option_b_label)) between 1 and 40),
  total_pot_agorot integer not null check (total_pot_agorot > 0),
  status text not null default 'open' check (status in ('open', 'locked', 'resolved', 'cancelled')),
  winning_option text check (winning_option in ('a', 'b')), -- null until resolved
  close_at timestamptz, -- optional join deadline; null = creator locks manually
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- A resolved bet always names the side that actually happened, even when
  -- nobody backed it (that case simply writes no ledger rows). Open, locked
  -- and cancelled bets never have a winner.
  constraint bets_winner_matches_status check (
    (status = 'resolved') = (winning_option is not null)
  ),
  constraint bets_resolved_requires_timestamp check (
    (status = 'resolved') = (resolved_at is not null)
  )
);

create index bets_group_id_created_at_idx on public.bets (group_id, created_at desc);
create index bets_status_idx on public.bets (status);

-- One row per user per bet — a user can only take one side.
create table public.bet_positions (
  bet_id uuid not null references public.bets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  joined_at timestamptz not null default now(),
  primary key (bet_id, user_id)
);

create index bet_positions_user_id_idx on public.bet_positions (user_id);

-- Per-user net result of one resolved bet (positive = owed to them,
-- negative = they owe). This is NOT a pairwise IOU — it is a balance line.
-- Group-wide settlement nets these later.
create table public.bet_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  amount_agorot integer not null, -- signed
  created_at timestamptz not null default now(),
  unique (bet_id, user_id)
);

create index bet_ledger_entries_group_user_idx
  on public.bet_ledger_entries (group_id, user_id);

-- A member ticking "mark as paid" on a suggested settlement transaction.
-- These are folded back into the balance calculation so a settled transaction
-- does not reappear on the next render.
create table public.settlement_confirmations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user_id uuid not null references public.users (id) on delete cascade,
  to_user_id uuid not null references public.users (id) on delete cascade,
  amount_agorot integer not null check (amount_agorot > 0),
  confirmed_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  constraint settlement_confirmations_distinct_parties
    check (from_user_id <> to_user_id)
);

create index settlement_confirmations_group_idx
  on public.settlement_confirmations (group_id);
