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
