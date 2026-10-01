-- Harden RPC authorization: a NULL `auth.uid()` must refuse, not fall through.
--
-- ---------------------------------------------------------------------------
-- The finding
-- ---------------------------------------------------------------------------
-- `resolve_bet_with_entries` is the only thing that writes `bet_ledger_entries`
-- — it is what turns a called bet into what people owe each other. Two
-- independent defects stacked on it, and either alone would have been
-- contained.
--
-- **One: the authorization check did not fire for an anonymous caller.** It
-- read
--
--     if v_bet.creator_id <> auth.uid() then raise exception ... end if;
--
-- With no session `auth.uid()` is NULL, so `creator_id <> NULL` evaluates to
-- NULL rather than true, and PL/pgSQL treats a NULL condition as false. The
-- `raise` never ran. The guard that exists to say "only the creator may call
-- this" passed *everyone* who was not signed in.
--
-- **Two: the function was reachable without a session.**
-- `…_stake_text.sql` re-declared it after `…_relock_anon_execute.sql` had swept
-- the schema, and ended with
--
--     revoke all on function ... from public;
--
-- `PUBLIC` and `anon` are different grantees. Revoking the implicit PUBLIC
-- grant does not touch the explicit `anon` grant the platform re-applies to
-- newly created objects in this schema — which is the whole finding recorded
-- in `…_relock_anon_execute.sql`, hit a second time by the very next migration
-- that created a function. So the role every client holds before it signs in
-- kept EXECUTE on it.
--
-- Together: the anon key could resolve any bet, and resolution writes signed
-- ledger rows that decide what real people owe. That is the highest-value
-- write in the schema.
--
-- ---------------------------------------------------------------------------
-- What this migration does
-- ---------------------------------------------------------------------------
-- 1. Re-declares `resolve_bet_with_entries` with the money logic byte-for-byte
--    unchanged — every balance check, every refusal, the insert and the status
--    flip are exactly as they were — and only the guard replaced: an explicit
--    "not signed in" refusal, then a NULL-safe `is distinct from`.
-- 2. Does the same for `revoke_group_invite`, which carried the identical
--    pattern. It sits behind the earlier sweep so it is not reachable today,
--    but a latent auth bypass that only a grant stands between is not a fixed
--    bug, and the next re-declaration would expose it exactly as this one was.
-- 3. Re-runs the anon sweep, because that is the only thing that has ever
--    actually held this class down, and two more migrations have landed since
--    it last ran.
--
-- `supabase/test/run.sh` section 50 asserts both halves: an anonymous caller is
-- refused, and a signed-in non-creator still is too.

-- ---------------------------------------------------------------------------
-- 1. The ledger function
-- ---------------------------------------------------------------------------
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
  -- `<>` against a NULL `auth.uid()` yields NULL, and PL/pgSQL treats a NULL
  -- IF as false — so an unauthenticated caller fell straight through this
  -- check instead of being refused by it. Both halves are fixed: the call is
  -- refused outright when nobody is signed in, and the comparison is now
  -- NULL-safe so it can never silently pass again.
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if v_bet.creator_id is distinct from auth.uid() then
    raise exception 'Only the bet creator can resolve it'
      using errcode = 'insufficient_privilege';
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

revoke all on function public.resolve_bet_with_entries(uuid, uuid, jsonb) from public, anon;
grant execute on function public.resolve_bet_with_entries(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Revoking an invite link
-- ---------------------------------------------------------------------------
-- Same shape, same fix. Without a session this said "only whoever made the
-- link, or an admin, can revoke it" and then did not stop anybody.
create or replace function public.revoke_group_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.group_invites;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invite from public.group_invites where token = p_token;
  if v_invite.id is null then
    return; -- already gone; nothing to say
  end if;

  if v_invite.created_by is distinct from auth.uid()
     and not public.is_group_admin(v_invite.group_id) then
    raise exception 'Only whoever made the link, or an admin, can revoke it'
      using errcode = 'insufficient_privilege';
  end if;

  update public.group_invites set revoked_at = now() where id = v_invite.id;
end;
$$;

revoke all on function public.revoke_group_invite(text) from public, anon;
grant execute on function public.revoke_group_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The sweep, again
-- ---------------------------------------------------------------------------
-- Idempotent, and the only mechanism that has actually held this class down.
-- `authenticated` keeps its explicit grants: a revoke aimed at PUBLIC and anon
-- does not touch them.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon', r.signature);
  end loop;
end $$;
