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
  values ('eeeeeeee-0000-4000-8000-000000000000',
          'bbbbbbbb-0000-4000-8000-000000000000',
          'aaaaaaaa-0000-4000-8000-000000000000',
          'Who is paying?', 'Me', 'You', 9000);
  insert into public.bet_options (bet_id, position, label)
  values ('eeeeeeee-0000-4000-8000-000000000000', 2, 'We split it');

  select 'a three-option bet' as check, count(*) as options
    from public.bet_options where bet_id = 'eeeeeeee-0000-4000-8000-000000000000';

  -- Five people across the three options: 2 on Me, 1 on You, 2 on We split it.
  select 'join option 0' as check,
         (public.join_bet_option('eeeeeeee-0000-4000-8000-000000000000',
            (select id from public.bet_options
              where bet_id = 'eeeeeeee-0000-4000-8000-000000000000' and position = 0))).option_id is not null;

  select 'the letter is kept in step for the first two' as check, side
    from public.bet_positions
   where bet_id = 'eeeeeeee-0000-4000-8000-000000000000'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000000';

  select 'the third option has no letter, and that is fine' as check,
         public.join_bet_option('eeeeeeee-0000-4000-8000-000000000000',
           (select id from public.bet_options
             where bet_id = 'eeeeeeee-0000-4000-8000-000000000000' and position = 2)) is not null;
  select 'side after moving to option 3' as check, coalesce(side, '(none)')
    from public.bet_positions
   where bet_id = 'eeeeeeee-0000-4000-8000-000000000000'
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
