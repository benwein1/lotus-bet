-- ===========================================================================
-- Test data: five members, some bets, and enough resolved history to exercise
-- settle-up.
--
-- NOT a migration. It lives outside `supabase/migrations/` on purpose — this
-- is disposable test data for one project, not schema, and it must never run
-- as part of a deploy. Paste it into the Supabase SQL editor.
--
-- Prerequisites
--   1. All five migrations applied, `…_email_auth.sql` included.
--   2. A group whose invite code is RHMXXW. The script fails loudly if it
--      cannot find one, rather than seeding into the wrong place.
--
-- What it creates
--   * Five accounts (fixed uuids, so re-running is idempotent), which can
--     sign in with the passwords listed below if you want to see the app as
--     one of them.
--   * All five joined to the RHMXXW group.
--   * A side taken by each of them on every bet already open in that group,
--     so your own bets have people in them.
--   * Three new bets, already resolved, between the five of them — which is
--     what gives the settle-up screen balances to simplify.
--   * Two new bets left open for you to join and resolve yourself.
--
-- About the ledger rows
--   `bet_ledger_entries` is normally written only by the `resolve-bet` Edge
--   Function, which calls `computeBetPayouts` — the single, unit-tested
--   implementation of the payout maths. This script does not reimplement it.
--   The amounts below were produced by running that exact module over these
--   exact participants and pots, and pasted in as literals:
--
--     bet 1  pot 12000, side a wins, 3 winners / 2 losers
--            +4000 +4000 +4000  /  -6000 -6000
--     bet 2  pot 10000, side b wins, 3 winners / 2 losers
--            +3334 +3333 +3333  /  -5000 -5000
--     bet 3  pot  5000, side a wins, 2 winners / 3 losers
--            +2500 +2500        /  -1667 -1667 -1666
--
--   Each set sums to zero and each side nets to exactly the pot, including
--   the leftover agora that goes to the lowest-sorting user id. If you change
--   a pot or a participant here, do not recompute by hand — resolve the bet
--   through the app instead and let the Edge Function write the rows.
--
-- To undo everything this created, see the bottom of the file.
-- ===========================================================================

begin;

-- `crypt`/`gen_salt` come from pgcrypto, which Supabase installs into the
-- `extensions` schema; the SQL editor does not always have it on the path.
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 0. Find the group
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.groups where invite_code = 'RHMXXW') then
    raise exception
      'No group with invite code RHMXXW. Open the app, check the code on the group screen, and change it at the top of this script.';
  end if;
end $$;

create temporary table seed_ctx on commit drop as
select
  g.id            as group_id,
  g.created_by    as owner_id
from public.groups g
where g.invite_code = 'RHMXXW';

-- ---------------------------------------------------------------------------
-- 1. Five accounts
-- ---------------------------------------------------------------------------
-- Written straight into `auth.users` because there is no server-side signup to
-- call from SQL. `handle_new_auth_user` picks each row up and seeds
-- `public.users` from `raw_user_meta_data`, exactly as a real sign-up would,
-- so these accounts are not a special case anywhere in the app.
--
-- They can all sign in with the password `lotus-test-1234`.
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  -- Declared NOT NULL without a default in some GoTrue versions, so they are
  -- written explicitly rather than left to chance.
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  person.id,
  'authenticated',
  'authenticated',
  person.email,
  crypt('lotus-test-1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', person.name),
  now(),
  now(),
  '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'dana.test@lotusbet.local',    'Dana Peretz'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'yonatan.test@lotusbet.local', 'Yonatan Adler'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'maya.test@lotusbet.local',    'Maya Cohen'),
  ('00000000-0000-4000-8000-000000000004'::uuid, 'itai.test@lotusbet.local',    'Itai Barak'),
  ('00000000-0000-4000-8000-000000000005'::uuid, 'noa.test@lotusbet.local',     'Noa Shemesh')
) as person(id, email, name)
on conflict (id) do nothing;

-- Belt and braces: if the signup trigger is not installed on this project the
-- insert above leaves no profile behind, and every join below would fail on a
-- foreign key. This fills the gap and is a no-op when the trigger did its job.
insert into public.users (id, email, display_name, profile_completed)
select
  person.id, person.email, person.name, true
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'dana.test@lotusbet.local',    'Dana Peretz'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'yonatan.test@lotusbet.local', 'Yonatan Adler'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'maya.test@lotusbet.local',    'Maya Cohen'),
  ('00000000-0000-4000-8000-000000000004'::uuid, 'itai.test@lotusbet.local',    'Itai Barak'),
  ('00000000-0000-4000-8000-000000000005'::uuid, 'noa.test@lotusbet.local',     'Noa Shemesh')
) as person(id, email, name)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Join them to the group
-- ---------------------------------------------------------------------------
insert into public.group_members (group_id, user_id, role)
select ctx.group_id, u.id, 'member'
from seed_ctx ctx
cross join (values
  ('00000000-0000-4000-8000-000000000001'::uuid),
  ('00000000-0000-4000-8000-000000000002'::uuid),
  ('00000000-0000-4000-8000-000000000003'::uuid),
  ('00000000-0000-4000-8000-000000000004'::uuid),
  ('00000000-0000-4000-8000-000000000005'::uuid)
) as u(id)
on conflict (group_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Take sides on the bets that are already open
-- ---------------------------------------------------------------------------
-- Alternating sides by user, so nothing ends up unanimous and the odds bar
-- has something to show. Bets past their `close_at` are skipped: the
-- `bet_positions_require_open` trigger rejects those, correctly.
insert into public.bet_positions (bet_id, user_id, side)
select
  b.id,
  u.id,
  case when u.n % 2 = 0 then 'a' else 'b' end
from seed_ctx ctx
join public.bets b
  on b.group_id = ctx.group_id
 and b.status = 'open'
 and (b.close_at is null or b.close_at > now())
cross join (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 1),
  ('00000000-0000-4000-8000-000000000002'::uuid, 2),
  ('00000000-0000-4000-8000-000000000003'::uuid, 3),
  ('00000000-0000-4000-8000-000000000004'::uuid, 4),
  ('00000000-0000-4000-8000-000000000005'::uuid, 5)
) as u(id, n)
on conflict (bet_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Three resolved bets, which is what settle-up runs on
-- ---------------------------------------------------------------------------
-- Inserted as `open` so the `bet_positions_require_open` trigger accepts the
-- positions, then flipped to `resolved`. That ordering is not optional.
insert into public.bets (
  id, group_id, creator_id, title, description,
  option_a_label, option_b_label, total_pot_agorot, status, created_at
)
select
  b.id, ctx.group_id, b.creator, b.title, b.description,
  b.label_a, b.label_b, b.pot, 'open', now() - b.age
from seed_ctx ctx
cross join (values
  (
    '00000000-0000-4000-8000-0000000000a1'::uuid,
    '00000000-0000-4000-8000-000000000001'::uuid,
    'Does Dana finish the half marathon under two hours?',
    'She has been talking about it for a month.',
    'Under 2:00', 'Over 2:00', 12000, interval '9 days'
  ),
  (
    '00000000-0000-4000-8000-0000000000a2'::uuid,
    '00000000-0000-4000-8000-000000000002'::uuid,
    'Is the new place on Dizengoff actually any good?',
    null,
    'Worth it', 'Overrated', 10000, interval '6 days'
  ),
  (
    '00000000-0000-4000-8000-0000000000a3'::uuid,
    '00000000-0000-4000-8000-000000000005'::uuid,
    'Does Itai make it to brunch before eleven?',
    'Historical base rate: poor.',
    'On time', 'Late again', 5000, interval '3 days'
  )
) as b(id, creator, title, description, label_a, label_b, pot, age)
on conflict (id) do nothing;

insert into public.bet_positions (bet_id, user_id, side)
values
  -- Bet 1: a wins (Dana, Yonatan, Maya) / b loses (Itai, Noa)
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'a'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002', 'a'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000003', 'a'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000004', 'b'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000005', 'b'),
  -- Bet 2: b wins (Yonatan, Maya, Noa) / a loses (Dana, Itai)
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'a'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000004', 'a'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000002', 'b'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000003', 'b'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000005', 'b'),
  -- Bet 3: a wins (Yonatan, Noa) / b loses (Dana, Maya, Itai)
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000002', 'a'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000005', 'a'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'b'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000003', 'b'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000004', 'b')
on conflict (bet_id, user_id) do nothing;

-- `winning_option_id` is what marks a bet resolved now — the letter is kept in
-- step for older clients, but the constraint keys off the option row.
update public.bets
   set status = 'resolved',
       winning_option = v.winner,
       winning_option_id = (
         select o.id from public.bet_options o
          where o.bet_id = v.id
            and o.position = case v.winner when 'a' then 0 else 1 end
       ),
       resolved_at = now() - v.age
from (values
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'a', interval '8 days'),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, 'b', interval '5 days'),
  ('00000000-0000-4000-8000-0000000000a3'::uuid, 'a', interval '2 days')
) as v(id, winner, age)
where bets.id = v.id
  and bets.status = 'open';

-- The literals from the header. Every group of five sums to zero.
insert into public.bet_ledger_entries (bet_id, group_id, user_id, amount_agorot)
select e.bet_id, ctx.group_id, e.user_id, e.amount
from seed_ctx ctx
cross join (values
  -- Bet 1: pot 12000, 3 winners at +4000, 2 losers at -6000
  ('00000000-0000-4000-8000-0000000000a1'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,  4000),
  ('00000000-0000-4000-8000-0000000000a1'::uuid, '00000000-0000-4000-8000-000000000002'::uuid,  4000),
  ('00000000-0000-4000-8000-0000000000a1'::uuid, '00000000-0000-4000-8000-000000000003'::uuid,  4000),
  ('00000000-0000-4000-8000-0000000000a1'::uuid, '00000000-0000-4000-8000-000000000004'::uuid, -6000),
  ('00000000-0000-4000-8000-0000000000a1'::uuid, '00000000-0000-4000-8000-000000000005'::uuid, -6000),
  -- Bet 2: pot 10000, 3 winners share it (the odd agora goes to the lowest
  -- sorting id, which is Yonatan), 2 losers at -5000
  ('00000000-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, -5000),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-000000000002'::uuid,  3334),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-000000000003'::uuid,  3333),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-000000000004'::uuid, -5000),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, '00000000-0000-4000-8000-000000000005'::uuid,  3333),
  -- Bet 3: pot 5000, 2 winners at +2500, 3 losers cover it (the odd two
  -- agorot land on the two lowest-sorting ids)
  ('00000000-0000-4000-8000-0000000000a3'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, -1667),
  ('00000000-0000-4000-8000-0000000000a3'::uuid, '00000000-0000-4000-8000-000000000002'::uuid,  2500),
  ('00000000-0000-4000-8000-0000000000a3'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, -1667),
  ('00000000-0000-4000-8000-0000000000a3'::uuid, '00000000-0000-4000-8000-000000000004'::uuid, -1666),
  ('00000000-0000-4000-8000-0000000000a3'::uuid, '00000000-0000-4000-8000-000000000005'::uuid,  2500)
) as e(bet_id, user_id, amount)
on conflict (bet_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Two open bets for you
-- ---------------------------------------------------------------------------
-- Left open deliberately: joining one and resolving it from the app is what
-- puts *you* into the ledger, and it exercises the real `resolve-bet` path
-- rather than these pasted numbers.
insert into public.bets (
  id, group_id, creator_id, title, description,
  option_a_label, option_b_label, total_pot_agorot, status, close_at, created_at
)
select
  b.id, ctx.group_id, b.creator, b.title, b.description,
  b.label_a, b.label_b, b.pot, 'open', now() + b.closes, now() - interval '1 day'
from seed_ctx ctx
cross join (values
  (
    '00000000-0000-4000-8000-0000000000b1'::uuid,
    '00000000-0000-4000-8000-000000000003'::uuid,
    'Do we actually go camping this month?',
    'Two cancellations already.',
    'We go', 'We bail', 8000, interval '5 days'
  ),
  (
    '00000000-0000-4000-8000-0000000000b2'::uuid,
    '00000000-0000-4000-8000-000000000004'::uuid,
    'Maccabi win their next match?',
    null,
    'Win', 'Anything else', 6000, interval '2 days'
  )
) as b(id, creator, title, description, label_a, label_b, pot, closes)
on conflict (id) do nothing;

insert into public.bet_positions (bet_id, user_id, side)
values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000003', 'a'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'a'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000004', 'b'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000004', 'a'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000002', 'b'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000005', 'b')
on conflict (bet_id, user_id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Check it landed
-- ---------------------------------------------------------------------------
-- Run this after the script. `group_balances` is the same function the
-- settle-up screen calls, so if the numbers look right here they will look
-- right in the app.
--
--   select u.display_name, b.amount_agorot
--   from public.groups g
--   cross join lateral public.group_balances(g.id) b
--   join public.users u on u.id = b.user_id
--   where g.invite_code = 'RHMXXW'
--   order by b.amount_agorot desc;
--
-- Expected, before anyone settles up:
--   Yonatan Adler   +9834
--   Noa Shemesh     -167
--   Maya Cohen      +5666
--   Dana Peretz     -2667
--   Itai Barak      -12666
-- (These sum to zero. Your own balance is 0 until you join and resolve one.)

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------
-- Removes everything above and nothing else. Deleting the accounts cascades
-- through their memberships, positions and ledger rows.
--
--   delete from public.bets
--    where id in (
--      '00000000-0000-4000-8000-0000000000a1',
--      '00000000-0000-4000-8000-0000000000a2',
--      '00000000-0000-4000-8000-0000000000a3',
--      '00000000-0000-4000-8000-0000000000b1',
--      '00000000-0000-4000-8000-0000000000b2'
--    );
--
--   delete from auth.users
--    where id in (
--      '00000000-0000-4000-8000-000000000001',
--      '00000000-0000-4000-8000-000000000002',
--      '00000000-0000-4000-8000-000000000003',
--      '00000000-0000-4000-8000-000000000004',
--      '00000000-0000-4000-8000-000000000005'
--    );
