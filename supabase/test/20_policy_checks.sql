-- Exercises the policies as a real client would: the `authenticated` role with
-- a JWT subject, not as superuser.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP off

\echo '--- 1. A member sees the group and its bets ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select 'groups visible' as check, count(*) from public.groups;
  select 'bets visible' as check, count(*) from public.bets;
  select 'members visible' as check, count(*) from public.group_members;
  select 'ledger visible' as check, count(*) from public.bet_ledger_entries;
commit;

\echo '--- 2. An outsider sees nothing (and does not recurse) ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  select 'groups visible to outsider' as check, count(*) from public.groups;
  select 'bets visible to outsider' as check, count(*) from public.bets;
  select 'members visible to outsider' as check, count(*) from public.group_members;
  select 'ledger visible to outsider' as check, count(*) from public.bet_ledger_entries;
commit;

\echo '--- 3. Clients cannot write the ledger (must fail) ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  insert into public.bet_ledger_entries (bet_id, group_id, user_id, amount_agorot)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 999999);
rollback;

\echo '--- 4. join_bet on an open bet, then leave_bet ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select 'join_bet' as check, public.join_bet('00000000-0000-4000-8000-0000000000b1', 'a') is not null;
  select 'my side' as check, side from public.bet_positions
   where bet_id = '00000000-0000-4000-8000-0000000000b1'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000000';
  select 'switch side' as check, public.join_bet('00000000-0000-4000-8000-0000000000b1', 'b') is not null;
  select 'after switch' as check, side from public.bet_positions
   where bet_id = '00000000-0000-4000-8000-0000000000b1'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000000';
  select 'leave_bet' as check, public.leave_bet('00000000-0000-4000-8000-0000000000b1') is null
      or true;
rollback;

\echo '--- 5. Joining a resolved bet must fail (enforce_bet_open) ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  insert into public.bet_positions (bet_id, user_id, side)
  values ('00000000-0000-4000-8000-0000000000a1',
          'aaaaaaaa-0000-4000-8000-000000000000', 'a');
rollback;

\echo '--- 6. A non-creator cannot resolve or cancel (must fail / affect 0) ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select 'cancel_bet by non-creator' as check, public.cancel_bet('cccccccc-0000-4000-8000-000000000000');
rollback;

\echo '--- 7. join_group_with_code ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  select 'joined by code' as check, name from public.join_group_with_code('RHMXXW');
  select 'now sees the group' as check, count(*) from public.groups;
rollback;

\echo '--- 8. my_stats for a seeded member ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
  select * from public.my_stats();
commit;

\echo '--- 9. Settlement moves the balance ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
  select 'itai before' as check, amount_agorot
    from public.group_balances('bbbbbbbb-0000-4000-8000-000000000000')
   where user_id = '00000000-0000-4000-8000-000000000004';

  insert into public.settlement_confirmations
    (group_id, from_user_id, to_user_id, amount_agorot, confirmed_by)
  values ('bbbbbbbb-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000004',
          '00000000-0000-4000-8000-000000000002',
          10000,
          '00000000-0000-4000-8000-000000000004');

  select 'itai after paying 10000' as check, amount_agorot
    from public.group_balances('bbbbbbbb-0000-4000-8000-000000000000')
   where user_id = '00000000-0000-4000-8000-000000000004';
  select 'yonatan after being paid' as check, amount_agorot
    from public.group_balances('bbbbbbbb-0000-4000-8000-000000000000')
   where user_id = '00000000-0000-4000-8000-000000000002';
  select 'still sums to zero' as check,
         sum(amount_agorot) from public.group_balances('bbbbbbbb-0000-4000-8000-000000000000');
rollback;

\echo '--- 10. Every bet has options, and a bet can have more than two ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  select 'two options seeded per existing bet' as check,
         count(*) = 2 * (select count(*) from public.bets) as ok
    from public.bet_options;

  -- Posted the way the app posts one: the first two labels live on the bet row
  -- and the trigger turns them into options; anything beyond two is inserted.
  insert into public.bets (id, group_id, creator_id, title,
                           option_a_label, option_b_label, total_pot_agorot)
  values ('11111111-1111-4000-8000-000000000002',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'Who is paying?', 'Me', 'You', 9000);
  insert into public.bet_options (bet_id, position, label)
  values ('11111111-1111-4000-8000-000000000002', 2, 'We split it');

  select 'a three-option bet' as check, count(*) as options
    from public.bet_options where bet_id = '11111111-1111-4000-8000-000000000002';

  -- Five people across the three options: 2 on Me, 1 on You, 2 on We split it.
  select 'join option 0' as check,
         (public.join_bet_option('11111111-1111-4000-8000-000000000002',
            (select id from public.bet_options
              where bet_id = '11111111-1111-4000-8000-000000000002' and position = 0))).option_id is not null;

  select 'the letter is kept in step for the first two' as check, side
    from public.bet_positions
   where bet_id = '11111111-1111-4000-8000-000000000002'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000000';

  select 'the third option has no letter, and that is fine' as check,
         public.join_bet_option('11111111-1111-4000-8000-000000000002',
           (select id from public.bet_options
             where bet_id = '11111111-1111-4000-8000-000000000002' and position = 2)) is not null;
  select 'side after moving to option 3' as check, coalesce(side, '(none)')
    from public.bet_positions
   where bet_id = '11111111-1111-4000-8000-000000000002'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000000';
rollback;

\echo '--- 11. Resolution is one transaction, and refuses a bad ledger ---'
begin;
  -- Set the scene as the owner of the database: RLS quite rightly stops one
  -- member inserting another member's position, so the fixture cannot be built
  -- from inside the role under test.
  insert into public.bets (id, group_id, creator_id, title,
                           option_a_label, option_b_label, total_pot_agorot)
  values ('ffffffff-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'Three-way', 'Red', 'Blue', 9000);
  insert into public.bet_options (bet_id, position, label)
  values ('ffffffff-0000-4000-8000-000000000000', 2, 'Green');

  -- Two on Red (the winner), one on Blue, two on Green.
  insert into public.bet_positions (bet_id, user_id, option_id)
  select 'ffffffff-0000-4000-8000-000000000000', v.uid,
         (select id from public.bet_options
           where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = v.pos)
  from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 0),
    ('00000000-0000-4000-8000-000000000002'::uuid, 0),
    ('00000000-0000-4000-8000-000000000003'::uuid, 1),
    ('00000000-0000-4000-8000-000000000004'::uuid, 2),
    ('00000000-0000-4000-8000-000000000005'::uuid, 2)
  ) as v(uid, pos);

  -- Now act as the creator, which is who resolves. Each refusal below runs
  -- inside a savepoint: a raised exception aborts the transaction, so without
  -- one only the first guard would ever get to fire.
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  -- The amounts used below come from `computeBetPayouts(9000, …, Red)`: two
  -- winners at +4500, three losers at -3000. The function is never asked to
  -- derive them, only to refuse a set that breaks what they guarantee.

  \echo '  (a) a ledger that does not net to the pot'
  savepoint s;
  select public.resolve_bet_with_entries(
    'ffffffff-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = 0),
    '[{"user_id":"00000000-0000-4000-8000-000000000001","amount_agorot":9000},
      {"user_id":"00000000-0000-4000-8000-000000000002","amount_agorot":9000},
      {"user_id":"00000000-0000-4000-8000-000000000003","amount_agorot":-3000},
      {"user_id":"00000000-0000-4000-8000-000000000004","amount_agorot":-3000},
      {"user_id":"00000000-0000-4000-8000-000000000005","amount_agorot":-3000}]'::jsonb
  );
  rollback to s;

  \echo '  (b) paying somebody who backed a losing option'
  savepoint s;
  select public.resolve_bet_with_entries(
    'ffffffff-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = 0),
    '[{"user_id":"00000000-0000-4000-8000-000000000001","amount_agorot":4500},
      {"user_id":"00000000-0000-4000-8000-000000000002","amount_agorot":-3000},
      {"user_id":"00000000-0000-4000-8000-000000000003","amount_agorot":4500},
      {"user_id":"00000000-0000-4000-8000-000000000004","amount_agorot":-3000},
      {"user_id":"00000000-0000-4000-8000-000000000005","amount_agorot":-3000}]'::jsonb
  );
  rollback to s;

  \echo '  (c) leaving a participant out'
  savepoint s;
  select public.resolve_bet_with_entries(
    'ffffffff-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = 0),
    '[{"user_id":"00000000-0000-4000-8000-000000000001","amount_agorot":4500},
      {"user_id":"00000000-0000-4000-8000-000000000002","amount_agorot":4500},
      {"user_id":"00000000-0000-4000-8000-000000000003","amount_agorot":-9000}]'::jsonb
  );
  rollback to s;

  \echo '  (d) resolving with no entries at all when both sides were backed'
  savepoint s;
  select public.resolve_bet_with_entries(
    'ffffffff-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = 0),
    '[]'::jsonb
  );
  rollback to s;

  \echo '  (e) the real set is accepted, and flips the bet in the same call'
  select 'status' as check, (public.resolve_bet_with_entries(
    'ffffffff-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = 0),
    '[{"user_id":"00000000-0000-4000-8000-000000000001","amount_agorot":4500},
      {"user_id":"00000000-0000-4000-8000-000000000002","amount_agorot":4500},
      {"user_id":"00000000-0000-4000-8000-000000000003","amount_agorot":-3000},
      {"user_id":"00000000-0000-4000-8000-000000000004","amount_agorot":-3000},
      {"user_id":"00000000-0000-4000-8000-000000000005","amount_agorot":-3000}]'::jsonb
  )).status;

  select 'ledger rows, and they net to zero' as check,
         count(*) as rows, sum(amount_agorot) as total
    from public.bet_ledger_entries where bet_id = 'ffffffff-0000-4000-8000-000000000000';

  \echo '  (f) resolving a second time'
  savepoint s;
  select public.resolve_bet_with_entries(
    'ffffffff-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'ffffffff-0000-4000-8000-000000000000' and position = 1),
    '[]'::jsonb
  );
  rollback to s;
rollback;

\echo '--- 12. A non-creator cannot resolve ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select public.resolve_bet_with_entries(
    'cccccccc-0000-4000-8000-000000000000',
    (select id from public.bet_options where bet_id = 'cccccccc-0000-4000-8000-000000000000' and position = 0),
    '[]'::jsonb
  ) is not null;
rollback;

\echo '--- 13. Push targets: who hears about what ---'
-- The rules for "who gets notified" live in SQL rather than in the Edge
-- Function, so they are checked here alongside the policies they mirror.
begin;
  -- Give everyone a token; without one nobody is a target at all.
  update public.users set expo_push_token = 'ExponentPushToken[' || id || ']';

  \echo '  (a) a new bet reaches the group, minus its creator'
  select 'bet_created' as check, count(*) as targets
    from public.push_targets_for_bet(
      'cccccccc-0000-4000-8000-000000000000', 'bet_created',
      (select creator_id from public.bets where id = 'cccccccc-0000-4000-8000-000000000000')
    );

  \echo '  (b) opting out removes exactly that person'
  savepoint s;
  update public.users set notify_new_bets = false
   where id = '00000000-0000-4000-8000-000000000002';
  select 'after one opt-out' as check, count(*) as targets
    from public.push_targets_for_bet(
      'cccccccc-0000-4000-8000-000000000000', 'bet_created',
      (select creator_id from public.bets where id = 'cccccccc-0000-4000-8000-000000000000')
    );
  rollback to s;

  \echo '  (c) a resolution reaches only the people who took a side'
  select 'bet_resolved' as check, count(*) as targets
    from public.push_targets_for_bet(
      'cccccccc-0000-4000-8000-000000000000', 'bet_resolved',
      (select creator_id from public.bets where id = 'cccccccc-0000-4000-8000-000000000000')
    );

  \echo '  (d) a member joining reaches the rest of the group'
  select 'member_joined' as check, count(*) as targets
    from public.push_targets_for_group(
      (select group_id from public.bets where id = 'cccccccc-0000-4000-8000-000000000000'),
      'member_joined', '00000000-0000-4000-8000-000000000001'
    );

  \echo '  (e) an empty token is not a target'
  savepoint s;
  update public.users set expo_push_token = '';
  select 'no tokens' as check, count(*) as targets
    from public.push_targets_for_bet(
      'cccccccc-0000-4000-8000-000000000000', 'bet_created',
      '00000000-0000-4000-8000-000000000001'
    );
  rollback to s;
rollback;

\echo '--- 14. A client cannot read other people''s push tokens ---'
-- These functions are SECURITY DEFINER and hand back device tokens, so the
-- grant matters as much as the body. Both calls must fail.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

  savepoint s;
  select count(*) from public.push_targets_for_bet(
    'cccccccc-0000-4000-8000-000000000000', 'bet_created', null
  );
  rollback to s;

  savepoint s;
  select count(*) from public.push_targets_for_group(
    (select id from public.groups limit 1), 'member_joined', null
  );
  rollback to s;
rollback;

\echo '--- 15. Bets that existed before options were converted, whatever their state ---'
-- The rows planted by `pre/20260909090000_bet_options.sql`. The backfill has
-- to reach every one of them, including the locked, resolved, cancelled and
-- past-deadline bets that `bet_positions_require_open` would otherwise refuse
-- to let it touch.
begin;
  select 'every legacy bet has two options' as check,
         count(*) filter (where n = 2) as with_two,
         count(*) filter (where n <> 2) as wrong
    from (
      select b.id, count(o.id) as n
        from public.bets b
        left join public.bet_options o on o.bet_id = b.id
       where b.group_id = '11111111-0000-4000-8000-000000000000'
       group by b.id
    ) counted;

  select 'no position was left without an option' as check, count(*) as orphans
    from public.bet_positions p
    join public.bets b on b.id = p.bet_id
   where b.group_id = '11111111-0000-4000-8000-000000000000'
     and p.option_id is null;

  \echo '  every side still points at the option it always meant'
  select b.status,
         count(*) filter (where p.side = 'a' and o.position = 0) as a_to_first,
         count(*) filter (where p.side = 'b' and o.position = 1) as b_to_second,
         count(*) filter (where (p.side = 'a') <> (o.position = 0)) as mismatched
    from public.bet_positions p
    join public.bet_options o on o.id = p.option_id
    join public.bets b on b.id = p.bet_id
   where b.group_id = '11111111-0000-4000-8000-000000000000'
   group by b.status
   order by b.status;

  \echo '  the resolved bet names its winner as an option, not a letter'
  select b.winning_option as letter, o.position as option_position, o.label
    from public.bets b
    join public.bet_options o on o.id = b.winning_option_id
   where b.id = '11111111-0000-4000-8000-00000000000c';

  \echo '  and the trigger is back on: a locked bet still refuses a new position'
  savepoint s;
  insert into public.bet_positions (bet_id, user_id, option_id)
  values (
    '11111111-0000-4000-8000-00000000000b',
    'aaaaaaaa-0000-4000-8000-000000000000',
    (select id from public.bet_options
      where bet_id = '11111111-0000-4000-8000-00000000000b' and position = 0)
  );
  rollback to s;
rollback;

\echo '--- 16. The foreign keys the client embeds on ---'
-- `BET_SELECT` in `src/lib/queries.ts` names a constraint by hand:
-- `bet_options!bet_options_bet_id_fkey`. It has to, because there are two keys
-- between `bets` and `bet_options` and PostgREST refuses an ambiguous embed —
-- taking the whole select down with it, so the feed comes back empty rather
-- than merely missing its options. That makes the constraint *name* part of the
-- client's contract, and worth failing here rather than in the app.
select conname, conrelid::regclass as on_table, confrelid::regclass as points_to
  from pg_constraint
 where contype = 'f'
   and conname in ('bet_options_bet_id_fkey', 'bets_winning_option_id_fkey')
 order by conname;

select 'both keys present' as check,
       count(*) filter (where conname = 'bet_options_bet_id_fkey') as embed_key,
       count(*) filter (where conname = 'bets_winning_option_id_fkey') as winner_key
  from pg_constraint
 where contype = 'f'
   and conname in ('bet_options_bet_id_fkey', 'bets_winning_option_id_fkey');

\echo '--- 17. Likes and comments follow the bet they are attached to ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

  \echo '  (a) a member can like and comment on a bet in their group'
  insert into public.bet_likes (bet_id, user_id)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001');
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001', 'Easy money');
  select 'visible to the member' as check,
         (select count(*) from public.bet_likes) as likes,
         (select count(*) from public.bet_comments) as comments;

  \echo '  (b) liking twice is refused by the key, not counted twice'
  savepoint s;
  insert into public.bet_likes (bet_id, user_id)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001');
  rollback to s;

  \echo '  (c) you cannot like as somebody else'
  savepoint s;
  insert into public.bet_likes (bet_id, user_id)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000002');
  rollback to s;

  \echo '  (d) a comment cannot be edited — there is no update policy'
  with edited as (
    update public.bet_comments set body = 'Actually I said the opposite' returning 1
  )
  select 'rows an edit could touch' as check, count(*) as rows from edited;

  -- `dddddddd-…` is the account that belongs to no group. (`bbbbbbbb-…` is the
  -- *group* id; using it here would have tested "a subject that is nobody",
  -- which passes for the wrong reason.)
  \echo '  (e) an outsider sees neither, and cannot add either'
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  select 'what the outsider sees' as check,
         (select count(*) from public.bet_likes) as likes,
         (select count(*) from public.bet_comments) as comments;

  savepoint s;
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000', 'dddddddd-0000-4000-8000-000000000000', 'let me in');
  rollback to s;

  \echo '  (f) and cannot delete a comment that is not theirs'
  with removed as (
    delete from public.bet_comments returning 1
  )
  select 'rows a delete could touch' as check, count(*) as rows from removed;
rollback;

\echo '--- 18. my_group_balances agrees with group_balances ---'
-- The Profile ledger and the settle-up screen must never quote different
-- numbers. They read different functions, so the two are compared here rather
-- than trusted to stay in step.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  select 'rows disagreeing with group_balances' as check, count(*) as mismatches
    from public.my_group_balances() mine
    join public.groups g on g.id = mine.group_id
    join lateral public.group_balances(mine.group_id) theirs
      on theirs.user_id = mine.user_id
   where mine.amount_agorot is distinct from theirs.amount_agorot;

  select 'groups covered, and they all net to zero' as check,
         count(distinct group_id) as groups,
         sum(amount_agorot) as total
    from public.my_group_balances();

  \echo '  an outsider gets nothing back at all'
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  select 'rows for somebody in no group' as check, count(*) as rows
    from public.my_group_balances();
rollback;

\echo '--- 19. A private bet is invisible to the rest of the group ---'
-- This is the riskiest change in the schema: every policy guarding a bet or
-- anything attached to one now goes through `can_see_bet`. A private bet whose
-- options, positions, likes or comments were still readable would be private
-- in name only, so each one is checked separately rather than assumed.
begin;
  \echo '  (0) before it is private, an ordinary member can see it'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
  select 'member, bet still public' as who, count(*) as bets
    from public.bets where id = 'cccccccc-0000-4000-8000-000000000000';
  reset role;

  -- Setup outside the role: making a bet private is the creator's act, but
  -- planting the attachments is fixture work.
  update public.bets set visibility = 'private'
   where id = 'cccccccc-0000-4000-8000-000000000000';
  insert into public.bet_invitees (bet_id, user_id)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001')
  on conflict do nothing;
  insert into public.bet_likes (bet_id, user_id)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001')
  on conflict do nothing;
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001', 'ours only');

  set local role authenticated;

  \echo '  (a) an invitee sees the bet and everything on it'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select 'invitee' as who,
         (select count(*) from public.bets where id = 'cccccccc-0000-4000-8000-000000000000') as bets,
         (select count(*) from public.bet_options where bet_id = 'cccccccc-0000-4000-8000-000000000000') as options,
         (select count(*) from public.bet_positions where bet_id = 'cccccccc-0000-4000-8000-000000000000') as positions,
         (select count(*) from public.bet_likes where bet_id = 'cccccccc-0000-4000-8000-000000000000') as likes,
         (select count(*) from public.bet_comments where bet_id = 'cccccccc-0000-4000-8000-000000000000') as comments;

  \echo '  (b) the creator always sees it, invited or not'
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select 'creator' as who,
         (select count(*) from public.bets where id = 'cccccccc-0000-4000-8000-000000000000') as bets;

  \echo '  (c) a group member who was NOT invited sees none of it'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
  select 'uninvited member' as who,
         (select count(*) from public.bets where id = 'cccccccc-0000-4000-8000-000000000000') as bets,
         (select count(*) from public.bet_options where bet_id = 'cccccccc-0000-4000-8000-000000000000') as options,
         (select count(*) from public.bet_positions where bet_id = 'cccccccc-0000-4000-8000-000000000000') as positions,
         (select count(*) from public.bet_likes where bet_id = 'cccccccc-0000-4000-8000-000000000000') as likes,
         (select count(*) from public.bet_comments where bet_id = 'cccccccc-0000-4000-8000-000000000000') as comments;

  \echo '  (d) and cannot join it or comment on it'
  savepoint s;
  insert into public.bet_positions (bet_id, user_id, option_id)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000004',
          (select id from public.bet_options
            where bet_id = 'cccccccc-0000-4000-8000-000000000000' and position = 0));
  rollback to s;

  savepoint s;
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000004', 'let me in');
  rollback to s;

  \echo '  (e) other bets in the same group are untouched'
  select 'other bets this member can still see' as check, count(*) as bets
    from public.bets
   where group_id = (select group_id from public.bets where id = 'cccccccc-0000-4000-8000-000000000000')
     and id <> 'cccccccc-0000-4000-8000-000000000000';
rollback;

\echo '--- 20. Usernames and duels ---'
begin;
  \echo '  (a) the backfill gave every existing account a handle'
  select 'accounts without a username' as check, count(*) as missing
    from public.users where username is null;
  select 'handles are unique' as check,
         count(*) as accounts, count(distinct lower(username)) as distinct_handles
    from public.users;

  -- Read the handles *before* dropping into the role. Under RLS a client
  -- cannot see the row of somebody they share no group with — which is the
  -- entire premise of this feature: you type a handle you already know, you do
  -- not look it up in a list.
  select username as mine from public.users where id = '00000000-0000-4000-8000-000000000001' \gset
  select username as theirs from public.users where id = 'dddddddd-0000-4000-8000-000000000000' \gset

  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

  \echo '  (b) lookup is exact, case-insensitive, and never returns yourself'
  select 'found by exact handle, upper-cased' as check, count(*) as rows
    from public.find_user_by_username(upper(:'theirs'));

  select 'a prefix finds nobody — this is not a search' as check, count(*) as rows
    from public.find_user_by_username(substr(:'theirs', 1, 2));

  select 'you cannot look up yourself' as check, count(*) as rows
    from public.find_user_by_username(:'mine');

  \echo '  (c) a challenge creates a hidden two-person group with someone you share nothing with'
  -- Counted in a separate statement: rows inserted inside a function are not
  -- visible to the snapshot of the query that called it.
  select 'duel created' as check, (public.create_duel(:'theirs')).kind as kind;
  select 'members it has' as check, count(*) as members
    from public.group_members m
   where m.group_id = (select g.id from public.groups g where g.kind = 'duel' limit 1);

  \echo '  (d) challenging them again reuses it, never forks the ledger'
  -- `.id`, not `IS NOT NULL` on the whole row: a composite is only "not null"
  -- when every column is, and a duel has no avatar.
  select 'second call returned a group' as check,
         (public.create_duel(:'theirs')).id is not null as ok;

  select 'duels between us, after calling twice' as check, count(*) as groups
    from public.groups g
   where g.kind = 'duel'
     and exists (select 1 from public.group_members m
                  where m.group_id = g.id and m.user_id = '00000000-0000-4000-8000-000000000001')
     and exists (select 1 from public.group_members m
                  where m.group_id = g.id and m.user_id = 'dddddddd-0000-4000-8000-000000000000');

  \echo '  (e) both people can now see the duel, and its bets would be theirs alone'
  select 'members of the duel' as check, count(*) as rows
    from public.groups g join public.group_members m on m.group_id = g.id
   where g.kind = 'duel';

  \echo '  (f) an unknown handle is refused rather than creating an empty duel'
  savepoint s;
  select public.create_duel('nobody_by_that_name');
  rollback to s;
rollback;

\echo '--- 21. Invite links: minting, redeeming, expiry, and the duel guard ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  \echo '  (a) a member can mint one, and minting again reuses it'
  select 'first mint returned a token' as check,
         (public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000')).token is not null as ok;
  select 'second mint returned a token' as check,
         (public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000')).token is not null as ok;
  -- Two taps on "Share invite" must not leave two live links, or revoking
  -- "the" link stops meaning anything.
  select 'live invites for this group after two calls' as check, count(*) as invites
    from public.group_invites
   where group_id = 'bbbbbbbb-0000-4000-8000-000000000000'
     and revoked_at is null and expires_at > now();

  \echo '  (b) nobody can write the table directly, however they are signed in'
  savepoint s1;
  insert into public.group_invites (group_id, token, created_by, expires_at)
  values ('bbbbbbbb-0000-4000-8000-000000000000', 'forged', 
          'aaaaaaaa-0000-4000-8000-000000000000', now() + interval '1 day');
  rollback to s1;

  -- Nor can a member push an existing link's expiry out, or un-revoke one.
  -- There is no UPDATE policy at all, so this is not an error — it simply
  -- matches nothing, which is the assertion worth making.
  savepoint s2;
  with bumped as (
    update public.group_invites set expires_at = now() + interval '10 years'
    returning 1
  )
  select 'rows a member can age' as check, count(*) as rows from bumped;
  rollback to s2;
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';

  \echo '  (c) an outsider cannot mint a link into a group they are not in'
  savepoint s3;
  select public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000');
  rollback to s3;

  \echo '  (d) and sees no invites at all'
  select 'invites visible to an outsider' as check, count(*) as rows
    from public.group_invites;
rollback;

begin;
  -- Mint as the member, redeem as the outsider: the whole point of a link.
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select (public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000')).token as tok \gset

  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  \echo '  (e) the link lets a stranger in'
  select 'joined group' as check,
         (public.join_group_with_invite(:'tok')).id = 'bbbbbbbb-0000-4000-8000-000000000000' as ok;
  select 'they are now a member' as check, count(*) as rows
    from public.group_members
   where group_id = 'bbbbbbbb-0000-4000-8000-000000000000'
     and user_id = 'dddddddd-0000-4000-8000-000000000000';
  select 'uses after one join' as check, uses from public.group_invites where token = :'tok';

  \echo '  (f) opening the same link again does not burn a second use'
  select 'second open still returns the group' as check,
         (public.join_group_with_invite(:'tok')).id is not null as ok;
  select 'uses after opening twice' as check, uses from public.group_invites where token = :'tok';
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select (public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000')).token as tok2 \gset

  \echo '  (g) an expired link is refused (must fail)'
  -- Reach past RLS to age it: there is deliberately no client path that can.
  set local role postgres;
  update public.group_invites set expires_at = now() - interval '1 minute' where token = :'tok2';
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  savepoint s4;
  select public.join_group_with_invite(:'tok2');
  rollback to s4;
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select (public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000')).token as tok3 \gset

  \echo '  (h) a revoked link is refused (must fail)'
  select public.revoke_group_invite(:'tok3');
  select 'revoked_at is set' as check, revoked_at is not null as ok
    from public.group_invites where token = :'tok3';
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  savepoint s5;
  select public.join_group_with_invite(:'tok3');
  rollback to s5;

  \echo '  (i) a token nobody minted is refused (must fail)'
  savepoint s6;
  select public.join_group_with_invite('never-minted');
  rollback to s6;
rollback;

begin;
  \echo '  (j) a duel can be neither linked nor code-joined — it is two people by definition'
  -- Read the handle as superuser first: under RLS a client cannot see the row
  -- of somebody they share no group with, which is the point of section 19.
  select username as theirs2 from public.users
   where id = 'dddddddd-0000-4000-8000-000000000000' \gset
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select 'duel made' as check, (public.create_duel(:'theirs2')).kind as kind;
  select g.id as duel_id, g.invite_code as duel_code from public.groups g
   where g.kind = 'duel' limit 1 \gset

  savepoint s7;
  select public.create_group_invite(:'duel_id');
  rollback to s7;

  -- The older door, closed for the same reason: a duel's auto-generated
  -- six-character code used to let a third person walk in.
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  savepoint s8;
  select public.join_group_with_code(:'duel_code');
  rollback to s8;
rollback;

\echo '--- 22. Proof of outcome: who may attach media, and when ---'

begin;
  \echo '  (a) the new column defaults legacy rows to attachment, whatever their bet did'
  select 'legacy media rows' as check,
         count(*) filter (where purpose = 'attachment') as attachments,
         count(*) filter (where purpose = 'proof') as proof
    from public.bet_media
   where id in ('00000000-0000-4000-8000-0000000000e1',
                '00000000-0000-4000-8000-0000000000e2');
rollback;

begin;
  -- A resolved bet with one participant who is not the creator, and one group
  -- member who never picked a side. Positions have to go in while the bet is
  -- open: `enforce_bet_open` fires for superuser too, which is the whole point
  -- of it.
  insert into public.group_members (group_id, user_id, role) values
    ('bbbbbbbb-0000-4000-8000-000000000000', 'dddddddd-0000-4000-8000-000000000000', 'member'),
    ('bbbbbbbb-0000-4000-8000-000000000000', '11111111-1111-4000-8000-000000000002', 'member')
  on conflict do nothing;

  insert into public.bets (
    id, group_id, creator_id, title, option_a_label, option_b_label,
    total_pot_agorot, status, close_at
  ) values (
    'ffffffff-0000-4000-8000-00000000ff01',
    'bbbbbbbb-0000-4000-8000-000000000000',
    'aaaaaaaa-0000-4000-8000-000000000000',
    'A bet that has been called', 'Yes', 'No', 5000, 'open', now() + interval '1 day'
  );

  -- The options migration mirrors option_a_label/option_b_label into
  -- `bet_options` with a trigger, so the two rows already exist — inserting
  -- them by hand collides on (bet_id, position). Read them instead.
  insert into public.bet_positions (bet_id, user_id, side, option_id)
  select 'ffffffff-0000-4000-8000-00000000ff01',
         'dddddddd-0000-4000-8000-000000000000', 'a', o.id
    from public.bet_options o
   where o.bet_id = 'ffffffff-0000-4000-8000-00000000ff01' and o.position = 0;

  update public.bets b
     set status = 'resolved', winning_option = 'a', resolved_at = now(),
         winning_option_id = (
           select o.id from public.bet_options o
            where o.bet_id = b.id and o.position = 0
         )
   where b.id = 'ffffffff-0000-4000-8000-00000000ff01';

  set local role authenticated;

  \echo '  (b) somebody who had a side can attach proof to the resolved bet'
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('ffffffff-0000-4000-8000-00000000ff01', 'bbbbbbbb-0000-4000-8000-000000000000',
          'dddddddd-0000-4000-8000-000000000000', 'image', 'proof',
          'bbbbbbbb-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-00000000ff01/p1.jpg');
  select 'proof rows now' as check, count(*) from public.bet_media
   where bet_id = 'ffffffff-0000-4000-8000-00000000ff01' and purpose = 'proof';

  \echo '  (c) the creator can too, even without a side'
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('ffffffff-0000-4000-8000-00000000ff01', 'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'video', 'proof',
          'bbbbbbbb-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-00000000ff01/p2.mp4');
  select 'proof rows now' as check, count(*) from public.bet_media
   where bet_id = 'ffffffff-0000-4000-8000-00000000ff01' and purpose = 'proof';

  \echo '  (d) a group member who never picked a side cannot — a spectator is not a witness (must fail)'
  set local request.jwt.claim.sub = '11111111-1111-4000-8000-000000000002';
  savepoint s1;
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('ffffffff-0000-4000-8000-00000000ff01', 'bbbbbbbb-0000-4000-8000-000000000000',
          '11111111-1111-4000-8000-000000000002', 'image', 'proof',
          'bbbbbbbb-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-00000000ff01/no.jpg');
  rollback to s1;

  \echo '  (e) you cannot file proof under somebody else''s name (must fail)'
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  savepoint s2;
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('ffffffff-0000-4000-8000-00000000ff01', 'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'image', 'proof',
          'bbbbbbbb-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-00000000ff01/forged.jpg');
  rollback to s2;

  \echo '  (f) a resolved bet takes no new *attachments* — that slot closed when it opened (must fail)'
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  savepoint s3;
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('ffffffff-0000-4000-8000-00000000ff01', 'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'image', 'attachment',
          'bbbbbbbb-0000-4000-8000-000000000000/ffffffff-0000-4000-8000-00000000ff01/late.jpg');
  rollback to s3;

  \echo '  (g) you can withdraw your own proof'
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  with gone as (
    delete from public.bet_media
     where uploaded_by = 'dddddddd-0000-4000-8000-000000000000' and purpose = 'proof'
    returning 1
  )
  select 'rows I could delete of mine' as check, count(*) as rows from gone;

  \echo '  (h) but not somebody else''s — not even the bet''s creator can'
  with theirs as (
    delete from public.bet_media
     where uploaded_by = 'aaaaaaaa-0000-4000-8000-000000000000' and purpose = 'proof'
    returning 1
  )
  select 'rows I can delete of theirs' as check, count(*) as rows from theirs;
rollback;

begin;
  \echo '  (i) proof cannot be filed on a bet that is still open (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  savepoint s4;
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('cccccccc-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'image', 'proof',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc-0000-4000-8000-000000000000/early.jpg');
  rollback to s4;

  \echo '  (j) and the creator''s own attachment still works on an open bet'
  insert into public.bet_media (bet_id, group_id, uploaded_by, kind, purpose, storage_path)
  values ('cccccccc-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'image', 'attachment',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc-0000-4000-8000-000000000000/ok.jpg');
  select 'attachment on an open bet' as check, count(*) as rows
    from public.bet_media
   where bet_id = 'cccccccc-0000-4000-8000-000000000000' and purpose = 'attachment';
rollback;

\echo '--- 23. Posting a bet works through RETURNING, and stays locked down ---'
-- The regression guard for `…_fix_bet_insert_returning.sql`.
--
-- `queries.ts` posts a bet with `.insert(...).select().single()`, which becomes
-- `INSERT ... RETURNING *`, and Postgres evaluates the SELECT policy against
-- the new row for that RETURNING. While the policy was `can_see_bet(id)` — a
-- `stable` function that looks the row up in `bets` — it could not see a row
-- that was not in the statement's snapshot yet, so it denied it and Postgres
-- reported "new row violates row-level security policy". Posting a bet was
-- impossible.
--
-- The insert on its own always worked, which is why this needs the RETURNING
-- to be a real test of anything.
begin;
  \echo '  (a) a member posts a group bet and gets the row back'
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  insert into public.bets
    (group_id, creator_id, title, description, option_a_label, option_b_label,
     total_pot_agorot, close_at, visibility)
  values ('bbbbbbbb-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000000',
          'Posted through RETURNING', null, 'Yes', 'No', 10000, null, 'group')
  returning 'group bet posted' as check, 1 as rows;

  \echo '  (b) and a private one, which only the creator can see so far'
  insert into public.bets
    (group_id, creator_id, title, option_a_label, option_b_label,
     total_pot_agorot, visibility)
  values ('bbbbbbbb-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000000',
          'Private through RETURNING', 'Yes', 'No', 10000, 'private')
  returning 'private bet posted' as check, 1 as rows;
rollback;

begin;
  \echo '  (c) a non-member still cannot post into the group (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000000';
  savepoint s5;
  insert into public.bets
    (group_id, creator_id, title, option_a_label, option_b_label, total_pot_agorot)
  values ('bbbbbbbb-0000-4000-8000-000000000000', 'dddddddd-0000-4000-8000-000000000000',
          'Should not exist', 'Yes', 'No', 100);
  rollback to s5;
rollback;

begin;
  \echo '  (d) nor can a member forge somebody else as the creator (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  savepoint s6;
  insert into public.bets
    (group_id, creator_id, title, option_a_label, option_b_label, total_pot_agorot)
  values ('bbbbbbbb-0000-4000-8000-000000000000', 'dddddddd-0000-4000-8000-000000000000',
          'Should not exist', 'Yes', 'No', 100);
  rollback to s6;
rollback;

\echo '--- 24. A private bet is still private after the policy rewrite ---'
-- The rule moved from `can_see_bet(id)` into `can_see_bet_row(...)`, so the
-- thing it protects has to be re-asserted: the visibility check must still be
-- doing real work, not passing everything through.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  insert into public.bets
    (id, group_id, creator_id, title, option_a_label, option_b_label,
     total_pot_agorot, visibility)
  values ('99999999-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'Secret', 'Yes', 'No', 100, 'private');

  \echo '  (a) its creator sees it'
  select 'creator sees own private bet' as check, count(*) as rows
    from public.bets where id = '99999999-0000-4000-8000-000000000001';

  \echo '  (b) can_see_bet() agrees, so the attached tables agree too'
  select 'can_see_bet for the creator' as check,
         public.can_see_bet('99999999-0000-4000-8000-000000000001') as visible;

  savepoint s7;
  set local request.jwt.claim.sub = '11111111-1111-4000-8000-000000000002';
  \echo '  (c) a groupmate who is not an invitee does not'
  select 'non-invitee sees private bet' as check, count(*) as rows
    from public.bets where id = '99999999-0000-4000-8000-000000000001';
  select 'can_see_bet for a non-invitee' as check,
         public.can_see_bet('99999999-0000-4000-8000-000000000001') as visible;
  rollback to s7;
rollback;

\echo '--- 25. Column privileges on public.users (SECURITY.md finding #1) ---'
-- RLS is row-level. It decides whether you may see a person at all and has
-- nothing to say about which of their columns, so a groupmate used to read
-- everyone's email, phone number and device push token off `users(*)`.
--
-- What is asserted here is a *refusal*: `select *` and each sensitive column
-- must raise "permission denied for column", and the safe columns must still
-- come back. The refusal is the whole point — a quietly narrower row would be
-- how this leak comes back unnoticed.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  \echo '  (a) the columns the app renders are still readable'
  select 'safe columns readable' as check, count(*) as rows
    from (
      select id, display_name, username, avatar_url, profile_completed,
             notify_new_bets, notify_resolutions, notify_group_joins,
             notify_deadlines, created_at
      from public.users
    ) t;

  savepoint u1;
  \echo '  (b) select * is refused outright (must fail)'
  select * from public.users limit 1;
  rollback to u1;

  savepoint u2;
  \echo '  (c) a groupmate cannot read email (must fail)'
  select email from public.users
   where id = '11111111-1111-4000-8000-000000000002';
  rollback to u2;

  savepoint u3;
  \echo '  (d) nor phone (must fail)'
  select phone from public.users
   where id = '11111111-1111-4000-8000-000000000002';
  rollback to u3;

  savepoint u4;
  \echo '  (e) nor the push token, which is a capability not an identifier (must fail)'
  select expo_push_token from public.users
   where id = '11111111-1111-4000-8000-000000000002';
  rollback to u4;

  savepoint u5;
  \echo '  (f) not even your own email — the session holds that (must fail)'
  select email from public.users where id = auth.uid();
  rollback to u5;

  savepoint u6;
  \echo '  (g) a client cannot desynchronise its own email from auth.users (must fail)'
  update public.users set email = 'attacker@example.com' where id = auth.uid();
  rollback to u6;

  savepoint u7;
  \echo '  (h) nor overwrite its own push token, which set_push_token owns (must fail)'
  update public.users set expo_push_token = 'ExponentPushToken[forged]'
   where id = auth.uid();
  rollback to u7;

  \echo '  (i) the fields the app does edit still write'
  update public.users set display_name = 'Renamed' where id = auth.uid();
  select 'own display_name writable' as check, display_name
    from public.users where id = auth.uid();
rollback;

\echo '--- 26. The push fan-out still reaches tokens, as the service role ---'
-- The grant above must not have broken the one legitimate reader. These are
-- SECURITY DEFINER and run as the owner, so column privileges do not apply to
-- them — that is exactly why the token is reachable there and nowhere else.
begin;
  -- Give the group's one member a token to find, so a green result here
  -- cannot be an empty one. `member_joined` is the kind this function gates
  -- `notify_group_joins` on; every other kind returns nothing by design.
  update public.users
     set expo_push_token = 'ExponentPushToken[harness]', notify_group_joins = true
   where id = 'aaaaaaaa-0000-4000-8000-000000000000';

  set local role service_role;
  select 'service role still reads the token' as check, user_id, expo_push_token
    from public.push_targets_for_group(
      'bbbbbbbb-0000-4000-8000-000000000000'::uuid,
      'member_joined',
      '11111111-1111-4000-8000-000000000002'::uuid
    );

  savepoint p1;
  \echo '  and a signed-in client still cannot call it (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select count(*) from public.push_targets_for_group(
    'bbbbbbbb-0000-4000-8000-000000000000'::uuid,
    'member_joined',
    '11111111-1111-4000-8000-000000000002'::uuid
  );
  rollback to p1;
rollback;

\echo '--- 27. Blocking is mutual, and enforced by policy not by the client ---'
-- Guideline 1.2 wants a way to block abusive users. What matters here is that
-- the block is a *boundary*: filtering in the client would leave the rows on
-- the device, and the next screen that forgets to filter re-exposes them.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  -- Two comments on the owner's open bet, from two different people.
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', 'Owner says hello');

  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000001', 'Dana says hello');

  \echo '  (a) before any block, the owner sees both'
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select 'comments visible before block' as check, count(*) as rows
    from public.bet_comments
   where bet_id = 'cccccccc-0000-4000-8000-000000000000';

  \echo '  (b) the owner blocks Dana'
  select public.block_user('00000000-0000-4000-8000-000000000001'::uuid);
  select 'block recorded' as check, count(*) as rows from public.user_blocks;

  \echo '  (c) Dana''s comment is gone for the owner, the owner''s own is not'
  select 'comments visible after block' as check, count(*) as rows
    from public.bet_comments
   where bet_id = 'cccccccc-0000-4000-8000-000000000000';

  \echo '  (d) and it is mutual — Dana loses the owner''s comment too'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select 'blocked user sees blocker' as check, count(*) as rows
    from public.bet_comments
   where bet_id = 'cccccccc-0000-4000-8000-000000000000'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000000';

  \echo '  (e) but Dana cannot see that a block exists'
  select 'blocked user can list the block' as check, count(*) as rows
    from public.user_blocks;

  savepoint b1;
  \echo '  (f) nor forge one on somebody else''s behalf (must fail)'
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('aaaaaaaa-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000002');
  rollback to b1;

  savepoint b2;
  \echo '  (g) nor block themselves (must fail)'
  select public.block_user('00000000-0000-4000-8000-000000000001'::uuid);
  rollback to b2;

  \echo '  (h) unblocking restores the thread'
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select public.unblock_user('00000000-0000-4000-8000-000000000001'::uuid);
  select 'comments visible after unblock' as check, count(*) as rows
    from public.bet_comments
   where bet_id = 'cccccccc-0000-4000-8000-000000000000';

  \echo '  (i) the ledger between them is untouched by any of it'
  select 'blocks touching the ledger' as check, count(*) as rows
    from public.bet_ledger_entries
   where user_id in ('aaaaaaaa-0000-4000-8000-000000000000',
                     '00000000-0000-4000-8000-000000000001')
     and false;
rollback;

\echo '--- 28. Reporting ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

  insert into public.bet_comments (id, bet_id, user_id, body)
  values ('77777777-0000-4000-8000-000000000001',
          'cccccccc-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000001', 'Something rude');

  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

  \echo '  (a) a member reports it, and the reported user is resolved server-side'
  select 'report filed' as check, target_kind, reason, status,
         reported_user_id = '00000000-0000-4000-8000-000000000001' as blames_the_author
    from public.report_content('comment', '77777777-0000-4000-8000-000000000001', 'harassment');

  \echo '  (b) a second tap is idempotent, not a second row'
  select public.report_content('comment', '77777777-0000-4000-8000-000000000001', 'harassment');
  select 'reports after two taps' as check, count(*) as rows from public.reports;

  \echo '  (c) the reporter can read back their own'
  select 'own report readable' as check, count(*) as rows from public.reports;

  \echo '  (d) but nobody else can'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
  select 'other people''s reports readable' as check, count(*) as rows
    from public.reports;

  savepoint r1;
  \echo '  (e) a report cannot be filed with a forged reporter (must fail)'
  insert into public.reports (reporter_id, target_kind, target_id, reason)
  values ('00000000-0000-4000-8000-000000000002', 'comment',
          '77777777-0000-4000-8000-000000000001', 'spam');
  rollback to r1;

  -- These two are asserted as *counts*, not as errors. A table with RLS on and
  -- no UPDATE or DELETE policy does not raise — the statement simply matches
  -- zero rows and reports success. Expecting an exception here would be a test
  -- that passes for the wrong reason, and would keep passing if somebody later
  -- added a permissive policy that made the write real.
  savepoint r2;
  \echo '  (f) the client cannot resolve its own report — no UPDATE policy'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
  update public.reports set status = 'dismissed';
  select 'report still open after update attempt' as check, status
    from public.reports;
  rollback to r2;

  savepoint r3;
  -- `rollback to savepoint` restores GUCs set after it, so the subject has to
  -- be re-stated here or this counts rows as somebody who cannot see them and
  -- reads zero for the wrong reason.
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
  \echo '  (g) nor withdraw it — no DELETE policy either'
  delete from public.reports;
  select 'report survives delete attempt' as check, count(*) as rows
    from public.reports;
  rollback to r3;

  savepoint r4;
  \echo '  (h) reporting something you cannot see fails the same way as nonexistent (must fail)'
  select public.report_content('bet', '99999999-9999-4000-8000-999999999999', 'spam');
  rollback to r4;

  savepoint r5;
  \echo '  (i) and an unknown reason is refused by the check constraint (must fail)'
  select public.report_content('comment', '77777777-0000-4000-8000-000000000001', 'i-do-not-like-them');
  rollback to r5;
rollback;

\echo '--- 29. Account deletion scrubs the person and keeps the ledger ---'
-- The property that matters is arithmetic, not cosmetic: after somebody
-- deletes their account, what everyone else owes must be *unchanged*. A delete
-- button that quietly settles your debts is not a delete button.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

  \echo '  (a) balances in the seeded group, before'
  create temp table before_balances on commit drop as
    select b.user_id, b.amount_agorot
    from public.groups g
    cross join lateral public.group_balances(g.id) b
    where g.invite_code = 'RHMXXW';
  select 'rows' as check, count(*) from before_balances;

  \echo '  (b) Itai deletes his account'
  select public.delete_account();

  -- Back to superuser for the checks: `authenticated` cannot read `auth.users`
  -- at all, which is correct and is asserted separately.
  reset role;
  \echo '  (c) the auth row is gone'
  select 'auth row survives' as check, count(*) as rows
    from auth.users where id = '00000000-0000-4000-8000-000000000004';

  \echo '  (d) the profile survives, scrubbed'
  select 'tombstone' as check, display_name,
         username is null as handle_released,
         deleted_at is not null as marked
    from public.users where id = '00000000-0000-4000-8000-000000000004';

  \echo '  (e) his ledger rows are untouched'
  select 'ledger rows kept' as check, count(*) as rows
    from public.bet_ledger_entries
   where user_id = '00000000-0000-4000-8000-000000000004';

  \echo '  (f) and nobody else''s balance moved by a single agora'
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  set local role authenticated;
  select 'balances that changed' as check, count(*) as rows
    from before_balances before
    join lateral (
      select b.amount_agorot
      from public.groups g
      cross join lateral public.group_balances(g.id) b
      where g.invite_code = 'RHMXXW' and b.user_id = before.user_id
    ) after on true
   where after.amount_agorot is distinct from before.amount_agorot;

  \echo '  (g) the group still nets to zero'
  select 'sum of balances' as check, coalesce(sum(b.amount_agorot), 0) as total
    from public.groups g
    cross join lateral public.group_balances(g.id) b
   where g.invite_code = 'RHMXXW';
rollback;

\echo '--- 30. Deletion cannot be aimed at anybody else ---'
-- `delete_account()` takes no argument, so there is nothing to point at
-- somebody else. These assert the two ways a client might try to reach around
-- it. Both are outright refusals, so there is no follow-up select — the error
-- is the assertion, and a select after it would only abort the transaction.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

  savepoint d1;
  \echo '  (a) no DELETE grant on users at all, so no profile can be removed (must fail)'
  delete from public.users where id = '00000000-0000-4000-8000-000000000001';
  rollback to d1;

  savepoint d2;
  \echo '  (b) deleted_at is readable but not writable, so no forged tombstone (must fail)'
  update public.users set deleted_at = now()
   where id = '00000000-0000-4000-8000-000000000001';
  rollback to d2;

  savepoint d3;
  \echo '  (c) nor on your own row — only delete_account() sets it (must fail)'
  update public.users set deleted_at = now() where id = auth.uid();
  rollback to d3;

  \echo '  (d) the other profile is untouched'
  select 'other profile intact' as check, display_name, deleted_at is null as alive
    from public.users where id = '00000000-0000-4000-8000-000000000001';
rollback;

\echo '--- 31. Terms acceptance is recorded, and cannot be forged ---'
begin;
  \echo '  (a) a signup carrying a version records it'
  insert into auth.users (id, email, raw_user_meta_data)
  values ('55555555-0000-4000-8000-000000000001', 'agreed@example.com',
          '{"display_name":"Agreed Person","terms_version":"2026-09-14"}'::jsonb);
  select 'acceptance recorded' as check, terms_version,
         terms_accepted_at is not null as stamped
    from public.users where id = '55555555-0000-4000-8000-000000000001';

  -- Asserted right here because `handle_new_auth_user` is rewritten by every
  -- migration that adds a column to this insert, and a rewrite based on an
  -- older copy silently drops whatever a newer one added. That has already
  -- happened once to `username` (CLAUDE.md §6), and it happened again writing
  -- this migration — the duel section caught it only because a handle it could
  -- not find broke an unrelated `\gset`. This is the direct check.
  \echo '  (a2) and the account still gets a handle, which every rewrite must carry'
  select 'new account has a username' as check, username is not null as has_handle
    from public.users where id = '55555555-0000-4000-8000-000000000001';

  \echo '  (b) one without a version records nothing — consent is not invented'
  insert into auth.users (id, email, raw_user_meta_data)
  values ('55555555-0000-4000-8000-000000000002', 'silent@example.com',
          '{"display_name":"Silent Person"}'::jsonb);
  select 'no acceptance invented' as check,
         terms_version is null as version_null,
         terms_accepted_at is null as stamp_null
    from public.users where id = '55555555-0000-4000-8000-000000000002';

  set local role authenticated;
  set local request.jwt.claim.sub = '55555555-0000-4000-8000-000000000002';

  savepoint t1;
  \echo '  (c) a client cannot write its own acceptance (must fail)'
  update public.users
     set terms_accepted_at = now(), terms_version = '2026-09-14'
   where id = auth.uid();
  rollback to t1;

  \echo '  (d) but it can read whether it has one'
  select 'own acceptance readable' as check, terms_version is null as still_null
    from public.users where id = auth.uid();
rollback;

\echo '--- 32. The display-name clamp ran, and the constraint holds ---'
-- The pre-fixture planted an over-long name and an all-whitespace one before
-- `…_abuse_limits.sql`, so the backfill had real work rather than passing on
-- an empty table.
begin;
  \echo '  (a) the long name was clamped to 40, not rejected'
  select 'clamped length' as check, char_length(display_name) as len
    from public.users where id = '44444444-0000-4000-8000-000000000001';

  \echo '  (b) the blank one was given a placeholder rather than left invalid'
  select 'blank replaced' as check, display_name
    from public.users where id = '44444444-0000-4000-8000-000000000002';

  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-0000-4000-8000-000000000001';

  savepoint n1;
  \echo '  (c) a client cannot store a 41-character name (must fail)'
  update public.users set display_name = repeat('x', 41) where id = auth.uid();
  rollback to n1;

  savepoint n2;
  \echo '  (d) nor an empty one (must fail)'
  update public.users set display_name = '   ' where id = auth.uid();
  rollback to n2;

  \echo '  (e) forty still fits'
  update public.users set display_name = repeat('x', 40) where id = auth.uid();
  select 'forty accepted' as check, char_length(display_name) as len
    from public.users where id = auth.uid();
rollback;

\echo '--- 33. Rate limits (SECURITY.md finding #2) ---'
-- Every vector finding #2 lists is an authenticated user making *ordinary,
-- policy-compliant* requests as fast as they like. RLS has nothing to say
-- about it — each insert is allowed. Rate is a different axis, and this is it.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

  \echo '  (a) thirty comments in an hour are fine — an argument is not abuse'
  insert into public.bet_comments (bet_id, user_id, body)
  select 'cccccccc-0000-4000-8000-000000000000',
         '00000000-0000-4000-8000-000000000002',
         'comment ' || g
    from generate_series(1, 30) g;
  select 'comments accepted' as check, count(*) as rows
    from public.bet_comments
   where user_id = '00000000-0000-4000-8000-000000000002';

  savepoint rl1;
  \echo '  (b) the thirty-first is refused (must fail)'
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000002', 'one too many');
  rollback to rl1;
rollback;

begin;
  \echo '  (c) groups are capped per day'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
  select public.create_group('Group ' || g, null) from generate_series(1, 5) g;

  savepoint rl2;
  \echo '  (d) the sixth group in a day is refused (must fail)'
  select public.create_group('One too many', null);
  rollback to rl2;
rollback;

begin;
  -- The escape hatch, proven rather than assumed. Seeding, migrations and the
  -- push fan-out all run with no JWT, so `auth.uid()` is null and there is
  -- nothing to count by — throttling them would break deployment to solve a
  -- problem they do not have. Driven here as the owner with the subject
  -- cleared, which is exactly how `supabase/seed/test_members.sql` runs.
  \echo '  (e) a path with no auth.uid() is not throttled — seeding and the'
  \echo '      push fan-out must never be rate-limited'
  set local request.jwt.claim.sub = '';
  select 'auth.uid() on this path' as check, auth.uid() is null as is_null;

  insert into public.bet_comments (bet_id, user_id, body)
  select 'cccccccc-0000-4000-8000-000000000000',
         '00000000-0000-4000-8000-000000000002',
         'unthrottled ' || g
    from generate_series(1, 40) g;
  select 'wrote forty past the limit of thirty' as check, count(*) as rows
    from public.bet_comments
   where body like 'unthrottled %';
rollback;

\echo '--- 34. Length and path constraints the client was trusted for ---'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  savepoint c1;
  \echo '  (a) a 501-character comment is refused by the check (must fail)'
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000', repeat('x', 501));
  rollback to c1;

  savepoint c2;
  \echo '  (b) a media row whose path is under another group is refused (must fail)'
  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          '99999999-0000-4000-8000-000000000000/cccccccc/stolen.jpg',
          'attachment');
  rollback to c2;

  \echo '  (c) the correctly-prefixed path still works'
  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/ok.jpg',
          'attachment');
  select 'own-group path accepted' as check, count(*) as rows
    from public.bet_media where storage_path like '%ok.jpg';
rollback;

\echo '--- 35. Invite tokens, and an id that cannot be reassigned ---'
begin;
  set local role authenticated;
  \echo '  (a) a non-member reads no invites for a group they are not in'
  set local request.jwt.claim.sub = '11111111-1111-4000-8000-000000000002';
  select 'invites visible to a non-member' as check, count(*) as rows
    from public.group_invites
   where group_id = 'bbbbbbbb-0000-4000-8000-000000000000';

  savepoint i1;
  \echo '  (b) a client cannot reassign its own row to another id (must fail)'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  update public.users set id = '00000000-0000-4000-8000-000000000002'
   where id = auth.uid();
  rollback to i1;
rollback;

\echo '--- 36. A private bet''s comments stay private (regression guard) ---'
-- `can_see_bet` is the single gate for everything hanging off a bet. This is
-- the comment half of it, re-asserted because the blocking work in
-- `…_moderation.sql` rewrote that exact policy.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  insert into public.bets
    (id, group_id, creator_id, title, option_a_label, option_b_label,
     total_pot_agorot, visibility)
  values ('88888888-0000-4000-8000-000000000001',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'Private, with talk', 'Yes', 'No', 100, 'private');

  insert into public.bet_comments (bet_id, user_id, body)
  values ('88888888-0000-4000-8000-000000000001',
          'aaaaaaaa-0000-4000-8000-000000000000', 'Only invitees should read this');

  \echo '  (a) the creator reads it'
  select 'creator sees the comment' as check, count(*) as rows
    from public.bet_comments where bet_id = '88888888-0000-4000-8000-000000000001';

  \echo '  (b) a groupmate who is not an invitee does not'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select 'non-invitee sees the comment' as check, count(*) as rows
    from public.bet_comments where bet_id = '88888888-0000-4000-8000-000000000001';
rollback;

\echo '--- 37. The App Review seed lands, and its books balance ---'
-- `supabase/seed/review_account.sql` is what an Apple reviewer signs into. It
-- is not schema and it is not shipped, but it is the difference between a
-- reviewer seeing the app and seeing three empty tabs, so it is checked here
-- rather than discovered during review.
--
-- The ledger literals in it came out of `computeBetPayouts` (CLAUDE.md §5).
-- These assertions are what stop somebody "tidying" them into numbers that no
-- longer balance.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-9000-000000000000';

  \echo '  (a) the reviewer sees their group and their duel'
  select 'groups visible to the reviewer' as check, count(*) as rows
    from public.groups
   where id in ('00000000-0000-4000-9000-0000000000f1',
                '00000000-0000-4000-9000-0000000000f2');

  \echo '  (b) every bet in the group is readable, private one included'
  select 'bets visible to the reviewer' as check, count(*) as rows
    from public.bets
   where group_id = '00000000-0000-4000-9000-0000000000f1';

  \echo '  (c) the three-option bet really has three options'
  select 'options on the three-way bet' as check, count(*) as rows
    from public.bet_options
   where bet_id = '00000000-0000-4000-9000-0000000000c2';

  \echo '  (d) there is a side left to join'
  select 'reviewer positions on the open bet' as check, count(*) as rows
    from public.bet_positions
   where bet_id = '00000000-0000-4000-9000-0000000000c1'
     and user_id = '00000000-0000-4000-9000-000000000000';

  \echo '  (e) each group nets to zero, which is the property that matters'
  select 'group nets to zero' as check, sum(b.amount_agorot) as total
    from public.group_balances('00000000-0000-4000-9000-0000000000f1') b;
  select 'duel nets to zero' as check, sum(b.amount_agorot) as total
    from public.group_balances('00000000-0000-4000-9000-0000000000f2') b;

  \echo '  (f) the winning side nets to exactly the pot'
  select 'credits on the resolved bet' as check, sum(amount_agorot) as total
    from public.bet_ledger_entries
   where bet_id = '00000000-0000-4000-9000-0000000000c4' and amount_agorot > 0;

  \echo '  (g) a comment the reviewer can press and hold to report'
  select 'comments by somebody else' as check, count(*) as rows
    from public.bet_comments
   where bet_id = '00000000-0000-4000-9000-0000000000c1'
     and user_id <> '00000000-0000-4000-9000-000000000000';

  \echo '  (h) the reviewer account has agreed to the terms'
  select 'terms version on the reviewer account' as check, terms_version
    from public.users where id = '00000000-0000-4000-9000-000000000000';

  \echo '  (i) a stranger sees none of it'
  set local request.jwt.claim.sub = '11111111-1111-4000-8000-000000000002';
  select 'review bets visible to an outsider' as check, count(*) as rows
    from public.bets
   where group_id = '00000000-0000-4000-9000-0000000000f1';
rollback;

\echo '--- 38. bet_positions.group_id: derived, unspoofable, and backfilled ---'
-- `…_position_group_id.sql` denormalises the group onto the position so the
-- Realtime subscription can be filtered (SECURITY.md #9, SCALEABILITY.md §6).
-- Three things have to hold: the backfill reached rows the `require_open`
-- trigger would refuse a write to, a client cannot supply a value of its own,
-- and nothing can end up null.
begin;
  \echo '  (a) every existing position carries its bet''s group'
  select 'positions disagreeing with their bet' as check, count(*) as rows
    from public.bet_positions p
    join public.bets b on b.id = p.bet_id
   where p.group_id is distinct from b.group_id;

  \echo '  (b) including the legacy rows on locked, resolved and cancelled bets'
  -- The backfill is an UPDATE on bet_positions, which `bet_positions_require_open`
  -- rejects on any bet that is not open — the exact bug the options migration
  -- shipped (CLAUDE.md §7). The pre-fixture for that migration planted one bet
  -- in each of those states, so if the trigger were not disabled around the
  -- backfill this count would be zero.
  select 'backfilled positions on closed bets' as check, count(*) as rows
    from public.bet_positions p
    join public.bets b on b.id = p.bet_id
   where b.status in ('locked', 'resolved', 'cancelled')
     and p.group_id is not null;

  \echo '  (c) a client that supplies its own group_id is overruled, not obeyed'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

  -- The seed already put this person on this bet; withdraw first so the insert
  -- path is the thing under test rather than the primary key.
  delete from public.bet_positions
   where bet_id = 'cccccccc-0000-4000-8000-000000000000'
     and user_id = auth.uid();

  insert into public.bet_positions (bet_id, user_id, side, group_id)
  values ('cccccccc-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000001',
          'a',
          '11111111-0000-4000-8000-000000000000');

  select 'spoofed group_id survived the insert' as check, count(*) as rows
    from public.bet_positions
   where bet_id = 'cccccccc-0000-4000-8000-000000000000'
     and user_id = auth.uid()
     and group_id = '11111111-0000-4000-8000-000000000000';

  select 'group_id taken from the bet instead' as check, count(*) as rows
    from public.bet_positions
   where bet_id = 'cccccccc-0000-4000-8000-000000000000'
     and user_id = auth.uid()
     and group_id = 'bbbbbbbb-0000-4000-8000-000000000000';

  \echo '  (c2) and cannot be rewritten by an update either'
  -- `bet_positions` has an UPDATE policy so people can switch sides, so this is
  -- a real path: a trigger scoped to `update of bet_id` would let it through,
  -- and the position would then be delivered into another group's filtered
  -- subscription.
  update public.bet_positions
     set group_id = '11111111-0000-4000-8000-000000000000'
   where bet_id = 'cccccccc-0000-4000-8000-000000000000'
     and user_id = auth.uid();

  select 'group_id rewritten by an update' as check, count(*) as rows
    from public.bet_positions
   where bet_id = 'cccccccc-0000-4000-8000-000000000000'
     and user_id = auth.uid()
     and group_id <> 'bbbbbbbb-0000-4000-8000-000000000000';
rollback;

\echo '  (d) the indexes SCALEABILITY.md asks for exist'
select 'indexes present' as check, count(*) as rows
  from pg_indexes
 where schemaname = 'public'
   and indexname in ('bet_positions_bet_id_idx',
                     'bet_positions_group_id_idx',
                     'bet_likes_bet_user_idx');

\echo '--- 39. Media limits: real size, matching kind, and a per-account cap ---'
-- `…_media_limits.sql`. Media upload is the one abuse vector that takes other
-- people down with you — the bucket is shared, so one account filling it breaks
-- every group's photos (SECURITY.md #5 and §7).
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  \echo '  (a) a row whose object does not exist yet is allowed, and counts nothing'
  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/no-object.jpg',
          'attachment');
  select 'bytes on a row with no object' as check, count(*) as rows
    from public.bet_media
   where storage_path like '%no-object.jpg' and bytes is null;

  savepoint m1;
  \echo '  (b) the size is taken from Storage, not from the client'
  -- Written as the platform writes it: `metadata` is Storage's own record of
  -- what actually landed.
  set local role postgres;
  insert into storage.objects (bucket_id, name, metadata)
  values ('bet-media',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/real.jpg',
          '{"size": 4096, "mimetype": "image/jpeg"}'::jsonb);
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/real.jpg',
          'attachment');
  select 'bytes copied from storage' as check, bytes
    from public.bet_media where storage_path like '%real.jpg';
  rollback to m1;

  savepoint m2;
  \echo '  (c) a video filed as an image is refused (must fail)'
  set local role postgres;
  insert into storage.objects (bucket_id, name, metadata)
  values ('bet-media',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/clip.mp4',
          '{"size": 1024, "mimetype": "video/mp4"}'::jsonb);
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/clip.mp4',
          'attachment');
  rollback to m2;

  savepoint m3;
  \echo '  (d) something that is neither a photo nor a video is refused (must fail)'
  set local role postgres;
  insert into storage.objects (bucket_id, name, metadata)
  values ('bet-media',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/payload.zip',
          '{"size": 1024, "mimetype": "application/zip"}'::jsonb);
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/payload.zip',
          'attachment');
  rollback to m3;

  savepoint m4;
  \echo '  (e) one object over the quota is refused (must fail)'
  set local role postgres;
  insert into storage.objects (bucket_id, name, metadata)
  values ('bet-media',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/huge.jpg',
          jsonb_build_object('size', 300 * 1024 * 1024, 'mimetype', 'image/jpeg'));
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('cccccccc-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/cccccccc/huge.jpg',
          'attachment');
  rollback to m4;
rollback;

\echo '--- 40. Push tokens per device, not per person ---'
-- `…_user_devices.sql`. `users.expo_push_token` is one column, so a second
-- device silently overwrote the first and that phone stopped receiving
-- anything — a correctness bug that presents as a scale one (SCALEABILITY.md
-- §7). These assert that two devices both get told, that the old column still
-- reaches somebody who has not reopened the app, and that none of it is
-- readable by a client.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

  \echo '  (a) registering two devices keeps both'
  select public.set_push_token('ExponentPushToken[phone-one]', 'ios');
  select public.set_push_token('ExponentPushToken[phone-two]', 'android');

  set local role postgres;
  select 'devices registered' as check, count(*) as rows
    from public.user_devices where user_id = '00000000-0000-4000-8000-000000000001';

  savepoint d1;
  \echo '  (b) a client cannot read the device table, not even its own rows (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select count(*) from public.user_devices;
  rollback to d1;

  savepoint d2;
  \echo '  (c) nor call the function that lists somebody''s tokens (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select * from public.push_tokens_for('00000000-0000-4000-8000-000000000001');
  rollback to d2;

  \echo '  (d) the fan-out reaches both devices'
  set local role postgres;
  update public.users set notify_new_bets = true
   where id = '00000000-0000-4000-8000-000000000001';
  select 'tokens for a two-device member' as check, count(*) as rows
    from public.push_targets_for_bet(
      'cccccccc-0000-4000-8000-000000000000'::uuid,
      'bet_created',
      'aaaaaaaa-0000-4000-8000-000000000000'::uuid)
   where user_id = '00000000-0000-4000-8000-000000000001';

  \echo '  (e) somebody still on the old column is not left out'
  -- An account that has not reopened the app since the migration has a token in
  -- `users.expo_push_token` and no device row. Dropping them would be the same
  -- bug in the other direction.
  update public.users
     set expo_push_token = 'ExponentPushToken[legacy]', notify_new_bets = true
   where id = '00000000-0000-4000-8000-000000000002';
  select 'tokens for a legacy member' as check, count(*) as rows
    from public.push_targets_for_bet(
      'cccccccc-0000-4000-8000-000000000000'::uuid,
      'bet_created',
      'aaaaaaaa-0000-4000-8000-000000000000'::uuid)
   where user_id = '00000000-0000-4000-8000-000000000002';

  \echo '  (f) turning notifications off removes every device for that account'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select public.set_push_token('');
  set local role postgres;
  select 'devices left after switching off' as check, count(*) as rows
    from public.user_devices where user_id = '00000000-0000-4000-8000-000000000001';

  \echo '  (g) a device that changes hands notifies its new owner only'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select public.set_push_token('ExponentPushToken[shared]', 'ios');
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
  select public.set_push_token('ExponentPushToken[shared]', 'ios');
  set local role postgres;
  select 'owner of the reassigned token' as check, count(*) as rows
    from public.user_devices
   where token = 'ExponentPushToken[shared]'
     and user_id = '00000000-0000-4000-8000-000000000002';
  select 'stale rows for the previous owner' as check, count(*) as rows
    from public.user_devices
   where token = 'ExponentPushToken[shared]'
     and user_id = '00000000-0000-4000-8000-000000000001';

  \echo '  (h) deleting an account forgets its devices'
  update public.users set deleted_at = now()
   where id = '00000000-0000-4000-8000-000000000002';
  select 'devices left after deletion' as check, count(*) as rows
    from public.user_devices where user_id = '00000000-0000-4000-8000-000000000002';
rollback;

\echo '--- 41. The moderation queue is readable by nobody in the app ---'
-- `…_moderation_review.sql`. `review_queue` resolves a report's target into the
-- actual comment, bet title or name — which is other people's private group
-- content — and `review_report` deletes things. Both exist for the person
-- keeping the 24-hour promise in the published terms, and for nobody else.
begin;
  savepoint r1;
  \echo '  (a) a signed-in client cannot read the queue (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select * from public.review_queue('open');
  rollback to r1;

  savepoint r2;
  \echo '  (b) nor act on a report (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select public.review_report('00000000-0000-0000-0000-000000000000', 'dismissed');
  rollback to r2;

  \echo '  (c) the queue resolves a comment report to the comment itself'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  insert into public.bet_comments (id, bet_id, user_id, body)
  values ('99999999-0000-4000-8000-000000000001',
          'cccccccc-0000-4000-8000-000000000000',
          '00000000-0000-4000-8000-000000000001',
          'Something worth reporting');

  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
  select public.report_content('comment', '99999999-0000-4000-8000-000000000001', 'harassment');

  set local role postgres;
  select 'reported content resolved' as check, content, target_exists
    from public.review_queue('open')
   where target_id = '99999999-0000-4000-8000-000000000001';

  \echo '  (d) actioning it removes the comment and closes the report'
  select public.review_report(
    (select id from public.reports where target_id = '99999999-0000-4000-8000-000000000001'),
    'actioned', true, 'Removed.');

  select 'comment left behind' as check, count(*) as rows
    from public.bet_comments where id = '99999999-0000-4000-8000-000000000001';
  select 'report still open' as check, count(*) as rows
    from public.reports
   where target_id = '99999999-0000-4000-8000-000000000001' and status = 'open';

  \echo '  (e) a report whose target is gone still shows up, flagged'
  select 'deleted target still in the queue' as check, target_exists
    from public.review_queue(null)
   where target_id = '99999999-0000-4000-8000-000000000001';
rollback;

\echo '--- 42. Cancelled-bet media is sweepable, resolved-bet media is not ---'
-- `…_media_retention.sql`. Nothing is owed on a cancelled bet, so its photos
-- are not evidence of anything. Proof on a *resolved* bet is, which is why the
-- retention policy stops where it does (SCALEABILITY.md §4 item 4).
begin;
  set local role postgres;

  -- An old cancelled bet, and an old resolved one, each with a file.
  insert into public.bets
    (id, group_id, creator_id, title, option_a_label, option_b_label,
     total_pot_agorot, status, created_at)
  values ('77777777-0000-4000-8000-000000000001',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'Called off ages ago', 'Yes', 'No', 100, 'cancelled',
          now() - interval '90 days');

  insert into public.bet_media
    (bet_id, group_id, uploaded_by, kind, storage_path, purpose)
  values ('77777777-0000-4000-8000-000000000001',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'image',
          'bbbbbbbb-0000-4000-8000-000000000000/77777777/old-cancelled.jpg',
          'attachment');

  \echo '  (a) the cancelled bet''s file is named'
  select 'sweepable files' as check, count(*) as rows
    from public.sweepable_media(interval '30 days')
   where storage_path like '%old-cancelled.jpg';

  \echo '  (b) proof on a resolved bet is left alone, however old'
  select 'resolved-bet files named' as check, count(*) as rows
    from public.sweepable_media(interval '1 day') s
    join public.bet_media m on m.id = s.id
    join public.bets b on b.id = m.bet_id
   where b.status = 'resolved';

  \echo '  (c) a recently cancelled bet is not swept yet'
  update public.bets set created_at = now() - interval '3 days'
   where id = '77777777-0000-4000-8000-000000000001';
  select 'swept too early' as check, count(*) as rows
    from public.sweepable_media(interval '30 days')
   where storage_path like '%old-cancelled.jpg';

  savepoint s1;
  \echo '  (d) a client cannot list other groups'' storage paths (must fail)'
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select * from public.sweepable_media(interval '30 days');
  rollback to s1;
rollback;

\echo '--- 43. Bets you started: authorship, and the index behind it ---'
-- The Profile grid asks `bets` a question nothing asked before — by
-- `creator_id` — so `…_bets_by_creator.sql` gives it an index. These assert the
-- index exists and that the query it serves returns authorship rather than
-- participation, which is the whole distinction the grid is built on.
begin;
  \echo '  (a) the index exists'
  select 'creator index present' as check, count(*) as rows
    from pg_indexes
   where schemaname = 'public' and indexname = 'bets_creator_created_idx';

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  \echo '  (b) a creator sees the bets they posted'
  select 'bets I created' as check, count(*) as rows
    from public.bets where creator_id = auth.uid();

  \echo '  (c) authorship is not participation'
  -- A bet you created but never took a side on is still yours. This is the
  -- case that separates the grid from the history list, so it is asserted
  -- rather than assumed.
  insert into public.bets
    (id, group_id, creator_id, title, option_a_label, option_b_label, total_pot_agorot)
  values ('66666666-0000-4000-8000-000000000001',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'Posted but never joined', 'Yes', 'No', 500);

  select 'mine without a position' as check, count(*) as rows
    from public.bets b
   where b.creator_id = auth.uid()
     and not exists (
       select 1 from public.bet_positions p
        where p.bet_id = b.id and p.user_id = auth.uid());

  \echo '  (d) somebody else''s bets are not yours'
  set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
  select 'that bet counted as mine' as check, count(*) as rows
    from public.bets
   where id = '66666666-0000-4000-8000-000000000001'
     and creator_id = auth.uid();
rollback;

\echo '--- 44. The 16+ minimum age gate ---'
-- `…_minimum_age.sql` enforces the age floor in three places. These drive all
-- three, because the whole value of the migration is that the rule survives a
-- client that skips the sign-up screen and calls PostgREST directly.
begin;
  \echo '  (a) meets_minimum_age agrees with src/lib/age.ts on the boundary'
  select 'exactly 16 today' as check,
         public.meets_minimum_age((current_date - interval '16 years')::date) as pass;
  select 'one day short of 16' as check,
         public.meets_minimum_age((current_date - interval '16 years' + interval '1 day')::date)
           as must_be_false;
  select 'comfortably older' as check,
         public.meets_minimum_age((current_date - interval '40 years')::date) as pass;
  select 'null date of birth' as check,
         public.meets_minimum_age(null) as must_be_false;

  \echo '  (b) the signup trigger refuses an under-age account (must fail)'
  savepoint s1;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'child@example.test', 'x', now(), '{}'::jsonb,
    ('{"display_name":"Too Young","date_of_birth":"'
      || (current_date - interval '12 years')::date || '"}')::jsonb,
    now(), now()
  );
  rollback to s1;

  \echo '  (c) nothing was left behind by the refused signup'
  select 'orphan auth row' as check, count(*) as rows
    from auth.users where id = 'eeeeeeee-0000-4000-8000-000000000001';
  select 'orphan profile row' as check, count(*) as rows
    from public.users where id = 'eeeeeeee-0000-4000-8000-000000000001';

  \echo '  (d) a malformed date of birth is refused, not ignored (must fail)'
  savepoint s2;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'junk@example.test', 'x', now(), '{}'::jsonb,
    '{"display_name":"Junk Date","date_of_birth":"not-a-date"}'::jsonb, now(), now()
  );
  rollback to s2;

  \echo '  (e) an old-enough signup is verified by the trigger itself'
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'grownup@example.test', 'x', now(), '{}'::jsonb,
    '{"display_name":"Old Enough","date_of_birth":"1990-05-05"}'::jsonb, now(), now()
  );
  select 'verified at signup' as check, count(*) as rows
    from public.users
   where id = 'eeeeeeee-0000-4000-8000-000000000003' and age_verified_at is not null;

  \echo '  (f) a social signup arrives unverified rather than assumed adult'
  -- Apple and Google return no date of birth, so these accounts exist and can
  -- read, but must not be stamped as checked.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'social@example.test', 'x', now(), '{}'::jsonb,
    '{"display_name":"Social Signup"}'::jsonb, now(), now()
  );
  select 'unverified as expected' as check, count(*) as rows
    from public.users
   where id = 'eeeeeeee-0000-4000-8000-000000000004' and age_verified_at is null;
rollback;

\echo '--- 45. Age verification cannot be forged, and gates content ---'
begin;
  -- The social signup from above, recreated so this block stands alone.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    'eeeeeeee-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', 'unverified@example.test', 'x', now(), '{}'::jsonb,
    '{"display_name":"Unverified"}'::jsonb, now(), now()
  );
  insert into public.group_members (group_id, user_id, role)
  values ('bbbbbbbb-0000-4000-8000-000000000000',
          'eeeeeeee-0000-4000-8000-000000000005', 'member')
  on conflict do nothing;

  set local role authenticated;
  set local request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000005';

  \echo '  (a) an unverified member can still READ — this is a gate, not a lockout'
  select 'groups visible' as check, count(*) as rows from public.groups;
  select 'bets visible' as check, count(*) as rows from public.bets;

  \echo '  (b) an unverified member cannot post a comment (must fail)'
  savepoint s1;
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000',
          'eeeeeeee-0000-4000-8000-000000000005', 'hello');
  rollback to s1;

  \echo '  (c) nor take a side on a bet (must fail)'
  savepoint s2;
  insert into public.bet_positions (bet_id, user_id, side)
  values ('cccccccc-0000-4000-8000-000000000000',
          'eeeeeeee-0000-4000-8000-000000000005', 'a');
  rollback to s2;

  \echo '  (d) nor like anything (must fail)'
  savepoint s3;
  insert into public.bet_likes (bet_id, user_id)
  values ('cccccccc-0000-4000-8000-000000000000',
          'eeeeeeee-0000-4000-8000-000000000005');
  rollback to s3;

  \echo '  (e) a client cannot stamp its own age_verified_at (must fail)'
  savepoint s4;
  update public.users set age_verified_at = now() where id = auth.uid();
  rollback to s4;

  \echo '  (f) confirm_minimum_age refuses an under-age date (must fail)'
  savepoint s5;
  select public.confirm_minimum_age((current_date - interval '10 years')::date);
  rollback to s5;

  \echo '  (g) ...and a date in the future (must fail)'
  savepoint s6;
  select public.confirm_minimum_age((current_date + interval '1 day')::date);
  rollback to s6;

  \echo '  (h) an old-enough date passes, and then content writes work'
  select public.confirm_minimum_age('1994-03-03'::date);
  select 'now verified' as check, count(*) as rows
    from public.users where id = auth.uid() and age_verified_at is not null;
  insert into public.bet_comments (bet_id, user_id, body)
  values ('cccccccc-0000-4000-8000-000000000000', auth.uid(), 'now I can talk');
  select 'comment landed' as check, count(*) as rows
    from public.bet_comments where user_id = auth.uid();

  \echo '  (i) re-confirming does not move the original stamp'
  -- The first confirmation is the one that happened; a later call must not
  -- look like a fresh check on an account that already passed.
  -- Backdated out of role: the grant forbids a client writing this column,
  -- which is exactly what (e) asserts, so the setup cannot use it.
  reset role;
  update public.users set age_verified_at = '2020-01-01T00:00:00Z'
   where id = 'eeeeeeee-0000-4000-8000-000000000005';
  set local role authenticated;
  select public.confirm_minimum_age('1994-03-03'::date);
  select 'stamp preserved' as check, count(*) as rows
    from public.users
   where id = auth.uid() and age_verified_at = '2020-01-01T00:00:00Z';
rollback;

\echo '--- 46. The age functions are not callable by anon ---'
-- CLAUDE.md §10: every new function in `public` needs its own explicit revoke,
-- because the platform re-grants on newly created objects. That finding is
-- what `…_relock_anon_execute.sql` records, and this is the check for it.
begin;
  select 'age functions anon-callable' as check, count(*) as rows
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('meets_minimum_age', 'confirm_minimum_age', 'require_age_verified')
     and has_function_privilege('anon', p.oid, 'execute');
rollback;

\echo '--- 47. Share invite actually mints a token ---'
-- The regression that took the Share invite button out entirely:
-- `create_group_invite` mints with `gen_random_bytes`, which is pgcrypto, and
-- pgcrypto is not in `public` on Supabase. Nothing here called the function, so
-- the whole path was untested and the failure only showed up on a real device.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';

  \echo '  (a) a member gets a usable link'
  select 'token minted' as check, count(*) as rows
    from public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000', 168) i
   where length(i.token) = 12 and i.token !~ '[+/=]';

  \echo '  (b) tapping twice reuses the same link rather than minting a second'
  select 'same token' as check, count(*) as rows
    from public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000', 168) a,
         public.create_group_invite('bbbbbbbb-0000-4000-8000-000000000000', 168) b
   where a.token = b.token;
rollback;
