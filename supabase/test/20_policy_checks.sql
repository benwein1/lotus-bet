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
