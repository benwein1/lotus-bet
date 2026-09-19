-- ===========================================================================
-- App Review account: everything a reviewer needs to see, in one paste.
--
-- NOT a migration. It lives outside `supabase/migrations/` on purpose — this
-- is disposable data for one project, not schema, and it must never run as
-- part of a deploy. Paste it into the Supabase SQL editor.
--
-- WHY THIS EXISTS
--   Betta has no public feed and no global discovery: a bet is only ever
--   visible inside a group you were invited to. A brand-new account therefore
--   opens onto three empty screens, and "we were unable to review your app" is
--   a rejection rather than a question. App Store Connect asks for demo
--   credentials for exactly this case; this script is what makes them worth
--   having.
--
-- PREREQUISITES
--   Every migration applied, up to and including
--   `20260916090400_abuse_limits.sql`. The script touches `users.username`,
--   `groups.kind`, `bets.visibility` and `bet_options`, all of which arrive in
--   later migrations, and it will fail loudly rather than half-seed if one is
--   missing.
--
-- WHAT IT CREATES
--   * A reviewer account — appreview@betta.local / AppReview-2026!
--     Put those exact strings in App Store Connect under App Review
--     Information, and the notes in APP_STORE.md section 6 beside them.
--   * Four friends, so the group is a group.
--   * One group, "Thursday Five", with the reviewer as its admin.
--   * Five bets in it: one open with the reviewer not yet on a side (so they
--     can join one), one open with three options, one locked, one resolved
--     with a real ledger, and one private with the reviewer invited.
--   * A duel — the two-person group a one-on-one challenge creates — with one
--     resolved bet in it, so the Profile ledger has somebody in it.
--   * Comments and likes, so the thread and the heart are not empty.
--
-- WHAT IT DELIBERATELY DOES NOT CREATE
--   Photos or video. `bet_media` rows point at objects in a private storage
--   bucket, and a row without its object renders as a broken image — worse
--   than no media at all. Attach one from the device instead; the reviewer
--   can do the same, which also exercises the permission prompt.
--
-- ABOUT THE LEDGER ROWS
--   `bet_ledger_entries` is written only by `resolve_bet_with_entries`, which
--   checks entries produced by `computeBetPayouts` — the single, unit-tested
--   implementation of the payout maths (CLAUDE.md section 5). This script does
--   not reimplement it. The amounts below came out of that exact module, run
--   over these exact participants and pots, and are pasted in as literals:
--
--     Thursday Five, "Does Dana run it under two hours?"
--       pot 10000, option A wins, 2 winners / 3 losers
--       +5000 +5000  /  -3334 -3333 -3333
--       (the extra agora lands on the lowest-sorting loser id, which is why
--        one of them is -3334 — that rule is what makes the books balance)
--
--     Duel, "Coffee on it?"
--       pot 4000, 1 winner / 1 loser:  +4000  /  -4000
--
--   Both sets sum to zero and each side nets to exactly the pot. If you change
--   a pot or a participant, do not recompute by hand — resolve the bet through
--   the app and let the RPC write the rows.
--
-- To undo everything this created, see the bottom of the file.
-- ===========================================================================

begin;

-- `crypt`/`gen_salt` come from pgcrypto, which Supabase installs into the
-- `extensions` schema; the SQL editor does not always have it on the path.
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run against a database that is missing a migration
-- ---------------------------------------------------------------------------
-- Half-seeded review data is worse than none: it looks like it worked and the
-- reviewer finds the hole.
do $$
begin
  if to_regclass('public.bet_options') is null then
    raise exception 'bet_options is missing — apply 20260909090000_bet_options.sql first.';
  end if;
  if to_regclass('public.bet_invitees') is null then
    raise exception 'bet_invitees is missing — apply 20260911090000_private_and_duels.sql first.';
  end if;
  if to_regclass('public.reports') is null then
    raise exception 'reports is missing — apply 20260916090100_moderation.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The accounts
-- ---------------------------------------------------------------------------
-- Written straight into `auth.users` because there is no server-side signup to
-- call from SQL. `handle_new_auth_user` picks each row up and seeds
-- `public.users` from `raw_user_meta_data` exactly as a real sign-up would —
-- display name, handle and terms acceptance included — so these accounts are
-- not a special case anywhere in the app.
--
-- `terms_version` is in the metadata for the same reason it is in the app's
-- own `signUp` call: an account with no acceptance on it is an account that
-- agreed to nothing, and the reviewer's account should look like a real one.
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
  crypt(person.password, gen_salt('bf')),
  -- Confirmed on the spot. If the project has email confirmation switched on,
  -- an unconfirmed reviewer account cannot sign in and the credentials in App
  -- Store Connect are dead on arrival.
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  -- Over the 16+ minimum, so the reviewer's account is verified by the signup
  -- trigger itself rather than by the fallback insert below.
  jsonb_build_object('display_name', person.name, 'terms_version', '2026-09-19',
                     'date_of_birth', '1995-06-12'),
  now() - interval '40 days',
  now(),
  '', '', '', ''
from (values
  ('00000000-0000-4000-9000-000000000000'::uuid, 'appreview@betta.local', 'Alex Rivera',   'AppReview-2026!'),
  ('00000000-0000-4000-9000-000000000001'::uuid, 'dana.demo@betta.local', 'Dana Peretz',   'betta-demo-1234'),
  ('00000000-0000-4000-9000-000000000002'::uuid, 'yoni.demo@betta.local', 'Yonatan Adler', 'betta-demo-1234'),
  ('00000000-0000-4000-9000-000000000003'::uuid, 'maya.demo@betta.local', 'Maya Cohen',    'betta-demo-1234'),
  ('00000000-0000-4000-9000-000000000004'::uuid, 'itai.demo@betta.local', 'Itai Barak',    'betta-demo-1234')
) as person(id, email, name, password)
on conflict (id) do nothing;

-- Belt and braces: if the signup trigger is not installed on this project the
-- insert above leaves no profile behind, and every join below fails on a
-- foreign key. This fills the gap and is a no-op when the trigger did its job.
insert into public.users (id, email, display_name, profile_completed, username, age_verified_at)
select
  person.id, person.email, person.name, true, person.handle, now()
from (values
  ('00000000-0000-4000-9000-000000000000'::uuid, 'appreview@betta.local', 'Alex Rivera',   'alexrivera'),
  ('00000000-0000-4000-9000-000000000001'::uuid, 'dana.demo@betta.local', 'Dana Peretz',   'danaperetz'),
  ('00000000-0000-4000-9000-000000000002'::uuid, 'yoni.demo@betta.local', 'Yonatan Adler', 'yonatanadler'),
  ('00000000-0000-4000-9000-000000000003'::uuid, 'maya.demo@betta.local', 'Maya Cohen',    'mayacohen'),
  ('00000000-0000-4000-9000-000000000004'::uuid, 'itai.demo@betta.local', 'Itai Barak',    'itaibarak')
) as person(id, email, name, handle)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The group
-- ---------------------------------------------------------------------------
-- The reviewer is its admin, which is what lets them lock, resolve and cancel
-- from the bet screen — the three creator-only controls, and the ones most
-- likely to be looked for.
insert into public.groups (id, name, emoji, created_by, invite_code, kind, created_at)
values (
  '00000000-0000-4000-9000-0000000000f1',
  'Thursday Five',
  '🏓',
  '00000000-0000-4000-9000-000000000000',
  'REVIEW',
  'group',
  now() - interval '35 days'
)
on conflict (id) do nothing;

insert into public.group_members (group_id, user_id, role, joined_at)
select
  '00000000-0000-4000-9000-0000000000f1', m.id, m.role, now() - interval '35 days'
from (values
  ('00000000-0000-4000-9000-000000000000'::uuid, 'admin'),
  ('00000000-0000-4000-9000-000000000001'::uuid, 'member'),
  ('00000000-0000-4000-9000-000000000002'::uuid, 'member'),
  ('00000000-0000-4000-9000-000000000003'::uuid, 'member'),
  ('00000000-0000-4000-9000-000000000004'::uuid, 'member')
) as m(id, role)
on conflict (group_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The bets
-- ---------------------------------------------------------------------------
-- Every bet is inserted as `open`, because `bet_positions_require_open` rejects
-- a position on anything else — correctly, and it holds no matter which path
-- writes the row. The locked and resolved ones are flipped afterwards. That
-- ordering is not optional.
--
-- The `bets` insert trigger writes `bet_options` rows 0 and 1 from the two
-- label columns on its own, so only the third option of the three-option bet
-- is inserted by hand below.
insert into public.bets (
  id, group_id, creator_id, title, description,
  option_a_label, option_b_label, total_pot_agorot,
  status, visibility, close_at, created_at
)
select
  b.id,
  '00000000-0000-4000-9000-0000000000f1',
  b.creator, b.title, b.description, b.label_a, b.label_b, b.pot,
  'open', b.visibility, b.close_at, b.created
from (values
  (
    '00000000-0000-4000-9000-0000000000c1'::uuid,
    '00000000-0000-4000-9000-000000000001'::uuid,
    'Do we actually make it to the courts on Thursday?',
    'Third week running that someone has cancelled.',
    'We play', 'We bail', 6000, 'group',
    now() + interval '4 days', now() - interval '2 days'
  ),
  (
    '00000000-0000-4000-9000-0000000000c2'::uuid,
    '00000000-0000-4000-9000-000000000002'::uuid,
    'Who is late to dinner on Saturday?',
    'Historical base rate suggests this is not a hard question.',
    'Itai', 'Maya', 4500, 'group',
    now() + interval '6 days', now() - interval '1 day'
  ),
  (
    '00000000-0000-4000-9000-0000000000c3'::uuid,
    '00000000-0000-4000-9000-000000000000'::uuid,
    'Does the new place on Dizengoff survive the year?',
    'Locked, because everyone who wanted in is in.',
    'It lasts', 'It closes', 8000, 'group',
    null, now() - interval '12 days'
  ),
  (
    '00000000-0000-4000-9000-0000000000c4'::uuid,
    '00000000-0000-4000-9000-000000000003'::uuid,
    'Does Dana run it under two hours?',
    'She has been talking about it for a month.',
    'Under 2:00', 'Over 2:00', 10000, 'group',
    null, now() - interval '20 days'
  ),
  (
    '00000000-0000-4000-9000-0000000000c5'::uuid,
    '00000000-0000-4000-9000-000000000001'::uuid,
    'Is Yonatan going to propose before the summer?',
    'Not for the whole group. Three of us know.',
    'He does', 'He does not', 5000, 'private',
    now() + interval '20 days', now() - interval '3 days'
  )
) as b(id, creator, title, description, label_a, label_b, pot, visibility, close_at, created)
on conflict (id) do nothing;

-- The third option on the "who is late" bet. Two is the minimum, eight the
-- maximum, and a reviewer should see that the odds bar is a stacked bar with a
-- legend rather than a green/red split when there are more than two.
insert into public.bet_options (bet_id, position, label)
values ('00000000-0000-4000-9000-0000000000c2', 2, 'Both of them')
on conflict (bet_id, position) do nothing;

-- Who is invited to the private one. The reviewer is, which is the point:
-- they should be able to see that it exists and that it is marked private.
insert into public.bet_invitees (bet_id, user_id)
values
  ('00000000-0000-4000-9000-0000000000c5', '00000000-0000-4000-9000-000000000000'),
  ('00000000-0000-4000-9000-0000000000c5', '00000000-0000-4000-9000-000000000001'),
  ('00000000-0000-4000-9000-0000000000c5', '00000000-0000-4000-9000-000000000002')
on conflict (bet_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Who backed what
-- ---------------------------------------------------------------------------
-- `fill_bet_position_option` derives `option_id` from `side` for the first two
-- options and `side` from `option_id` beyond them, so a third-option position
-- is written by naming the option rather than a letter.
--
-- The reviewer is deliberately absent from bet c1: an empty side to join is
-- the first thing worth doing in the app, and an account already on every bet
-- has nothing to try.
insert into public.bet_positions (bet_id, user_id, side)
values
  -- c1, open, reviewer not in it
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-000000000001', 'a'),
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-000000000003', 'a'),
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-000000000002', 'b'),
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-000000000004', 'b'),
  -- c2, open, three options; the reviewer is on one of them
  ('00000000-0000-4000-9000-0000000000c2', '00000000-0000-4000-9000-000000000000', 'a'),
  ('00000000-0000-4000-9000-0000000000c2', '00000000-0000-4000-9000-000000000002', 'a'),
  ('00000000-0000-4000-9000-0000000000c2', '00000000-0000-4000-9000-000000000001', 'b'),
  -- c3, about to be locked
  ('00000000-0000-4000-9000-0000000000c3', '00000000-0000-4000-9000-000000000000', 'a'),
  ('00000000-0000-4000-9000-0000000000c3', '00000000-0000-4000-9000-000000000003', 'a'),
  ('00000000-0000-4000-9000-0000000000c3', '00000000-0000-4000-9000-000000000002', 'b'),
  -- c4, about to be resolved: a wins (reviewer, Maya), b loses (Dana, Yonatan, Itai)
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000000', 'a'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000003', 'a'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000001', 'b'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000002', 'b'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000004', 'b'),
  -- c5, private
  ('00000000-0000-4000-9000-0000000000c5', '00000000-0000-4000-9000-000000000001', 'a'),
  ('00000000-0000-4000-9000-0000000000c5', '00000000-0000-4000-9000-000000000002', 'b')
on conflict (bet_id, user_id) do nothing;

-- The third-option backer, named by option rather than by letter.
insert into public.bet_positions (bet_id, user_id, option_id)
select
  '00000000-0000-4000-9000-0000000000c2',
  '00000000-0000-4000-9000-000000000004',
  o.id
from public.bet_options o
where o.bet_id = '00000000-0000-4000-9000-0000000000c2'
  and o.position = 2
on conflict (bet_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Lock one, resolve one
-- ---------------------------------------------------------------------------
update public.bets
   set status = 'locked'
 where id = '00000000-0000-4000-9000-0000000000c3'
   and status = 'open';

-- `winning_option_id` is what marks a bet resolved now — the letter is kept in
-- step for clients written before options existed, but the constraint keys off
-- the option row.
update public.bets
   set status = 'resolved',
       winning_option = 'a',
       winning_option_id = (
         select o.id from public.bet_options o
          where o.bet_id = public.bets.id and o.position = 0
       ),
       resolved_at = now() - interval '18 days'
 where id = '00000000-0000-4000-9000-0000000000c4'
   and status = 'open';

-- The literals from the header. They sum to zero, and the winning side nets to
-- exactly the pot.
insert into public.bet_ledger_entries (bet_id, group_id, user_id, amount_agorot)
select
  '00000000-0000-4000-9000-0000000000c4',
  '00000000-0000-4000-9000-0000000000f1',
  e.user_id, e.amount
from (values
  ('00000000-0000-4000-9000-000000000000'::uuid,  5000),
  ('00000000-0000-4000-9000-000000000003'::uuid,  5000),
  ('00000000-0000-4000-9000-000000000001'::uuid, -3334),
  ('00000000-0000-4000-9000-000000000002'::uuid, -3333),
  ('00000000-0000-4000-9000-000000000004'::uuid, -3333)
) as e(user_id, amount)
on conflict (bet_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. A duel
-- ---------------------------------------------------------------------------
-- A one-on-one challenge is a real two-person group with `kind = 'duel'`, not a
-- second kind of object — which is why every policy, balance and notification
-- path already works on it. The Groups tab hides these; the feed and the
-- Profile ledger do not, and the Profile ledger is where a reviewer sees that
-- "who owes who" nets across groups rather than per group.
insert into public.groups (id, name, emoji, created_by, invite_code, kind, created_at)
values (
  '00000000-0000-4000-9000-0000000000f2',
  'Alex and Dana',
  null,
  '00000000-0000-4000-9000-000000000000',
  'DUELRV',
  'duel',
  now() - interval '15 days'
)
on conflict (id) do nothing;

insert into public.group_members (group_id, user_id, role, joined_at)
values
  ('00000000-0000-4000-9000-0000000000f2', '00000000-0000-4000-9000-000000000000', 'admin',  now() - interval '15 days'),
  ('00000000-0000-4000-9000-0000000000f2', '00000000-0000-4000-9000-000000000001', 'member', now() - interval '15 days')
on conflict (group_id, user_id) do nothing;

insert into public.bets (
  id, group_id, creator_id, title, description,
  option_a_label, option_b_label, total_pot_agorot, status, created_at
)
values (
  '00000000-0000-4000-9000-0000000000d1',
  '00000000-0000-4000-9000-0000000000f2',
  '00000000-0000-4000-9000-000000000000',
  'Coffee on it?',
  'Loser buys for a week.',
  'Alex', 'Dana', 4000, 'open',
  now() - interval '14 days'
)
on conflict (id) do nothing;

insert into public.bet_positions (bet_id, user_id, side)
values
  ('00000000-0000-4000-9000-0000000000d1', '00000000-0000-4000-9000-000000000000', 'a'),
  ('00000000-0000-4000-9000-0000000000d1', '00000000-0000-4000-9000-000000000001', 'b')
on conflict (bet_id, user_id) do nothing;

update public.bets
   set status = 'resolved',
       winning_option = 'a',
       winning_option_id = (
         select o.id from public.bet_options o
          where o.bet_id = public.bets.id and o.position = 0
       ),
       resolved_at = now() - interval '13 days'
 where id = '00000000-0000-4000-9000-0000000000d1'
   and status = 'open';

insert into public.bet_ledger_entries (bet_id, group_id, user_id, amount_agorot)
values
  ('00000000-0000-4000-9000-0000000000d1', '00000000-0000-4000-9000-0000000000f2',
   '00000000-0000-4000-9000-000000000000',  4000),
  ('00000000-0000-4000-9000-0000000000d1', '00000000-0000-4000-9000-0000000000f2',
   '00000000-0000-4000-9000-000000000001', -4000)
on conflict (bet_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Something to read and something to tap
-- ---------------------------------------------------------------------------
-- A thread with a few remarks in it, so the comment sheet is not an empty
-- state, and so the reviewer has somebody else's comment to press and hold —
-- which is how reporting and blocking are reached (guideline 1.2).
--
-- Nothing here is written by the reviewer's own account: you cannot report
-- yourself, and a thread where every comment is yours hides the control.
insert into public.bet_comments (id, bet_id, user_id, body, created_at)
values
  ('00000000-0000-4000-9000-00000000e001', '00000000-0000-4000-9000-0000000000c1',
   '00000000-0000-4000-9000-000000000002', 'Booking the court at seven. No excuses this time.',
   now() - interval '2 days'),
  ('00000000-0000-4000-9000-00000000e002', '00000000-0000-4000-9000-0000000000c1',
   '00000000-0000-4000-9000-000000000004', 'I have a thing at eight but I can make the first hour.',
   now() - interval '44 hours'),
  ('00000000-0000-4000-9000-00000000e003', '00000000-0000-4000-9000-0000000000c1',
   '00000000-0000-4000-9000-000000000003', 'That is exactly what you said last week.',
   now() - interval '40 hours'),
  ('00000000-0000-4000-9000-00000000e004', '00000000-0000-4000-9000-0000000000c4',
   '00000000-0000-4000-9000-000000000001', 'One hour fifty eight. I would like everyone to note that.',
   now() - interval '18 days'),
  ('00000000-0000-4000-9000-00000000e005', '00000000-0000-4000-9000-0000000000c4',
   '00000000-0000-4000-9000-000000000004', 'Noted, and deeply regretted.',
   now() - interval '18 days')
on conflict (id) do nothing;

insert into public.bet_likes (bet_id, user_id, created_at)
values
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-000000000001', now() - interval '2 days'),
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-000000000003', now() - interval '2 days'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000002', now() - interval '18 days'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000003', now() - interval '18 days'),
  ('00000000-0000-4000-9000-0000000000c4', '00000000-0000-4000-9000-000000000004', now() - interval '18 days')
on conflict (bet_id, user_id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Check it landed
-- ---------------------------------------------------------------------------
-- `group_balances` is the same function the settle-up screen calls, so if the
-- numbers look right here they will look right in the app.
--
--   select g.name, u.display_name, b.amount_agorot
--   from public.groups g
--   cross join lateral public.group_balances(g.id) b
--   join public.users u on u.id = b.user_id
--   where g.id in (
--     '00000000-0000-4000-9000-0000000000f1',
--     '00000000-0000-4000-9000-0000000000f2'
--   )
--   order by g.name, b.amount_agorot desc;
--
-- Expected:
--   Alex and Dana    Alex Rivera    +4000
--   Alex and Dana    Dana Peretz    -4000
--   Thursday Five    Alex Rivera    +5000
--   Thursday Five    Maya Cohen     +5000
--   Thursday Five    Yonatan Adler  -3333
--   Thursday Five    Itai Barak     -3333
--   Thursday Five    Dana Peretz    -3334
--
-- Each group sums to zero. On the reviewer's Profile the two net together:
-- Dana owes 4000 from the duel and 3334 from Thursday Five, and "who owes who"
-- shows one line, not two — which is the thing worth checking.

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------
-- Removes everything above and nothing else.
--
-- NOTE the order. `…_account_deletion.sql` drops `users_id_fkey` on purpose —
-- deleting an auth row must not cascade into settled ledger entries and
-- silently change what other people owe (CLAUDE.md section 6). The consequence
-- here is that deleting from `auth.users` alone leaves the profiles behind, so
-- the profiles are deleted explicitly, and the groups first.
--
--   delete from public.groups
--    where id in (
--      '00000000-0000-4000-9000-0000000000f1',
--      '00000000-0000-4000-9000-0000000000f2'
--    );
--
--   delete from public.users
--    where id in (
--      '00000000-0000-4000-9000-000000000000',
--      '00000000-0000-4000-9000-000000000001',
--      '00000000-0000-4000-9000-000000000002',
--      '00000000-0000-4000-9000-000000000003',
--      '00000000-0000-4000-9000-000000000004'
--    );
--
--   delete from auth.users
--    where id in (
--      '00000000-0000-4000-9000-000000000000',
--      '00000000-0000-4000-9000-000000000001',
--      '00000000-0000-4000-9000-000000000002',
--      '00000000-0000-4000-9000-000000000003',
--      '00000000-0000-4000-9000-000000000004'
--    );
