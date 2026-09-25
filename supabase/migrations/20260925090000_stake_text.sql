-- A bet whose stake is not money.
--
-- "Loser buys dinner", "loser does 50 pushups", "winner picks the film". The
-- app records who owes whom; it has never touched money, and a forfeit is the
-- same promise between friends with the units taken out.
--
-- `stake_text` carries it, and the constraint below is the whole design: a bet
-- has a pot **or** a forfeit, never both. Allowing both would mean two answers
-- to "what is at stake here", and every screen would have to pick one.
--
-- Nothing about the money path changes. `payout.ts` is untouched — it is the
-- canonical implementation and a second one is how somebody gets paid the
-- wrong amount — and a forfeit bet simply has a pot of zero, so it computes to
-- no ledger entries and moves nothing. What did have to change is the guard in
-- `resolve_bet_with_entries`, which refused an empty ledger whenever both
-- sides were backed: correct for a money bet, and exactly wrong for this one.
-- Without that, a forfeit bet could be made and joined but never called.

alter table public.bets
  add column if not exists stake_text text;

alter table public.bets
  drop constraint if exists bets_stake_text_length;
alter table public.bets
  add constraint bets_stake_text_length
  check (stake_text is null or char_length(btrim(stake_text)) between 1 and 80);

-- A pot or a forfeit, never both. Existing bets all have a null `stake_text`,
-- so this holds for every row already in the table whatever its pot.
alter table public.bets
  drop constraint if exists bets_stake_xor_pot;
alter table public.bets
  add constraint bets_stake_xor_pot
  check (stake_text is null or total_pot_agorot = 0);

-- ...which the original pot check made impossible. `total_pot_agorot > 0` has
-- been right since the first migration — a money bet with an empty pot is a
-- bet about nothing — and it silently refused every forfeit bet, because a
-- forfeit's pot is zero by construction. The rule it was protecting is
-- unchanged for money bets and now says so explicitly: a pot is positive
-- unless there is a forfeit instead of one.
--
-- The SQL harness found this, not a reviewer. Section 55(c) inserted a
-- perfectly ordinary forfeit bet and watched `bets_total_pot_agorot_check`
-- reject it, which is the whole reason that harness exists.
alter table public.bets
  drop constraint if exists bets_total_pot_agorot_check;
alter table public.bets
  add constraint bets_total_pot_agorot_check
  check (
    case when stake_text is null then total_pot_agorot > 0
         else total_pot_agorot = 0
    end
  );

-- `bets` has no column-level grants — only `users` does — so the new column is
-- insertable by `authenticated` under the table grant the platform already
-- gave, and the existing RLS policy still decides which rows.

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
    -- The no-movement cases, and there are two of them now.
    --
    -- One is a bet where a side went unbacked: nobody to pay, or nobody to pay
    -- them, so `computeBetPayouts` returns no entries and the ledger stays
    -- untouched. That has always been legitimate.
    --
    -- The other is a bet whose stake is words rather than money — "loser buys
    -- dinner". There is no pot to split and nothing the ledger could record
    -- that would mean anything, so an empty entry list is the *only* correct
    -- answer for one, and refusing it would make such a bet unresolvable.
    if v_bet.stake_text is null and exists (
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
