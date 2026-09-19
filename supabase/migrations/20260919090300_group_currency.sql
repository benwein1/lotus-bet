-- Currency, per group.
--
-- ---------------------------------------------------------------------------
-- Why the group and not the bet
-- ---------------------------------------------------------------------------
-- Per-bet currency was the ask, and it breaks the ledger. `group_balances`
-- sums `amount_agorot` across every bet in a group into one number, and
-- `my_group_balances` + `personBalances` net that across every group you are
-- in. Those sums are what the settle-up screen and the Profile ledger read.
--
-- Mix currencies inside a group and the sum stops meaning anything: 100 US
-- cents plus 100 agorot is 200 of nothing, and the app would confidently tell
-- two people who owes whom based on it. There is no formatting fix for that —
-- the arithmetic is wrong before it reaches a formatter.
--
-- A group is the unit a balance is computed over, so it is the unit a currency
-- has to attach to. Every bet in a group shares it, every sum stays valid, and
-- `payout.ts` is untouched because the split maths never cared what the
-- integers denominate.
--
-- ---------------------------------------------------------------------------
-- The column keeps its name, and that is deliberate
-- ---------------------------------------------------------------------------
-- `total_pot_agorot` and `amount_agorot` now mean "minor units of the group's
-- currency" — cents in a USD group, agorot in an ILS one. Renaming them would
-- reach into `payout.ts`, which CLAUDE.md §5 names the highest-risk module in
-- the repo and forbids forking or reimplementing. The maths is integer maths
-- and is identical in every currency, so the rename would buy a better name at
-- the cost of touching the one file that must not be touched casually.
--
-- The comments below are the record instead.

alter table public.groups
  add column if not exists currency text not null default 'ILS'
    check (currency in ('ILS', 'USD', 'EUR', 'GBP'));

comment on column public.groups.currency is
  'ISO 4217 code for every amount in this group. The default is ILS because '
  'that is what every row predating this migration actually is — the app '
  'formatted agorot as shekels and nothing else was possible. New groups '
  'default to USD at the RPC, not here, so the backfill stays truthful.';

comment on column public.bets.total_pot_agorot is
  'The pot, in MINOR UNITS of the owning group''s currency — cents in a USD '
  'group, agorot in an ILS one. The name predates per-group currency; see '
  '20260919090300_group_currency.sql for why it was not renamed.';

comment on column public.bet_ledger_entries.amount_agorot is
  'Signed balance line, in minor units of the owning group''s currency. See '
  'the note on bets.total_pot_agorot.';

-- ---------------------------------------------------------------------------
-- Creating a group picks its currency, once
-- ---------------------------------------------------------------------------
-- Defaulted at the RPC rather than on the column so the two populations stay
-- honest: existing groups are ILS because they always were, and new ones are
-- USD because that is the product decision.
--
-- There is deliberately no way to change a group's currency afterwards. Doing
-- so would silently reinterpret every settled balance in it — the same numbers
-- meaning different money — and there is no correct conversion, because the
-- amounts are records of what people agreed, not values to be re-priced.
create or replace function public.create_group(
  p_name text,
  p_emoji text default null,
  p_currency text default 'USD'
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
  v_currency text := upper(coalesce(nullif(trim(p_currency), ''), 'USD'));
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if v_currency not in ('ILS', 'USD', 'EUR', 'GBP') then
    raise exception 'Unsupported currency: %', v_currency
      using errcode = 'invalid_parameter_value';
  end if;

  -- `invite_code` is NOT NULL and has no default: `…_functions.sql` generated
  -- it here, and a `create or replace` written without it makes every group
  -- creation fail outright. Exactly the trap CLAUDE.md §6 records for
  -- `handle_new_auth_user` — carry the whole insert forward, not just the part
  -- this migration is about. Caught by section 50(b) of the policy checks.
  insert into public.groups (name, emoji, created_by, invite_code, currency)
  values (
    trim(p_name),
    nullif(trim(coalesce(p_emoji, '')), ''),
    auth.uid(),
    public.generate_invite_code(),
    v_currency
  )
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'admin');

  return v_group;
end;
$$;

-- The two-argument form has to GO, not stay alongside.
--
-- Postgres resolves overloads by argument count, and both signatures accept one
-- or two arguments once defaults are counted — so `create_group('Friends')`
-- matches each of them and the call fails with "is not unique". Keeping the old
-- one as a forwarder is the obvious courtesy and it is exactly what breaks
-- every existing caller.
--
-- Dropping it costs nothing: PostgREST passes named parameters, so a client
-- still sending only `p_name` and `p_emoji` resolves to the function below with
-- `p_currency` defaulted. The old call sites keep working untouched.
drop function if exists public.create_group(text, text);

revoke execute on function public.create_group(text, text, text) from public, anon;
grant execute on function public.create_group(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Duels take the same default as any other new group
-- ---------------------------------------------------------------------------
-- `create_duel` inserts into `groups` directly rather than going through
-- `create_group`, so it would silently take the column default — ILS, which is
-- the backfill value for groups that predate this and wrong for a new one.
-- Naming it here keeps the two paths agreeing.
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

  select id into v_them from public.users
   where lower(username) = lower(trim(p_username)) and id <> v_me;

  if v_them is null then
    raise exception 'No one is using that username'
      using errcode = 'no_data_found';
  end if;

  -- Reuse an existing duel rather than making another. Without this a running
  -- total with one friend fragments across a dozen identical groups and the
  -- Profile ledger stops meaning anything.
  select g.* into v_group
  from public.groups g
  where g.kind = 'duel'
    and exists (select 1 from public.group_members m
                 where m.group_id = g.id and m.user_id = v_me)
    and exists (select 1 from public.group_members m
                 where m.group_id = g.id and m.user_id = v_them)
    and (select count(*) from public.group_members m where m.group_id = g.id) = 2
  limit 1;

  if v_group.id is not null then
    return v_group;
  end if;

  insert into public.groups (name, emoji, kind, created_by, invite_code, currency)
  values (
    (select display_name from public.users where id = v_me) || ' v ' ||
    (select display_name from public.users where id = v_them),
    '⚔️',
    'duel',
    v_me,
    public.generate_invite_code(),
    'USD'
  )
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, v_me, 'admin'), (v_group.id, v_them, 'member');

  return v_group;
end;
$$;

revoke execute on function public.create_duel(text) from public, anon;
grant execute on function public.create_duel(text) to authenticated;
