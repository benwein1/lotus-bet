-- Lotus Bet — RPC surface.
--
-- Anything that has to hold an invariant across more than one table lives here
-- rather than in the client, so it stays atomic and cannot be skipped.

-- ---------------------------------------------------------------------------
-- Signup: mirror auth.users into public.users
-- ---------------------------------------------------------------------------
-- Supabase phone OTP creates the auth row; this gives it a profile immediately
-- so foreign keys resolve. The display name starts as the last 4 phone digits
-- and the user renames themselves on the profile-setup screen.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, phone, display_name)
  values (
    new.id,
    coalesce(new.phone, new.id::text),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      'Player ' || right(coalesce(new.phone, new.id::text), 4)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------
-- 6 characters from an unambiguous alphabet (no 0/O/1/I) — short enough to
-- read out loud in a WhatsApp group.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from public.groups g where g.invite_code = v_code);

    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'Could not generate a unique invite code';
    end if;
  end loop;

  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_emoji text default null)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into public.groups (name, emoji, created_by, invite_code)
  values (trim(p_name), nullif(trim(coalesce(p_emoji, '')), ''), auth.uid(), public.generate_invite_code())
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'admin');

  return v_group;
end;
$$;

create or replace function public.join_group_with_code(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_group
  from public.groups g
  where upper(g.invite_code) = upper(trim(p_code));

  if v_group.id is null then
    raise exception 'No group found for that invite code'
      using errcode = 'no_data_found';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bets
-- ---------------------------------------------------------------------------
-- Take (or switch) a side. The open/close-time rules live in the
-- `bet_positions_require_open` trigger so every write path shares them.
create or replace function public.join_bet(p_bet_id uuid, p_side text)
returns public.bet_positions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_position public.bet_positions;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_side not in ('a', 'b') then
    raise exception 'Side must be a or b' using errcode = 'check_violation';
  end if;

  select b.group_id into v_group_id from public.bets b where b.id = p_bet_id;

  if v_group_id is null or not public.is_group_member(v_group_id) then
    raise exception 'Bet not found' using errcode = 'no_data_found';
  end if;

  insert into public.bet_positions (bet_id, user_id, side)
  values (p_bet_id, auth.uid(), p_side)
  on conflict (bet_id, user_id) do update set side = excluded.side
  returning * into v_position;

  return v_position;
end;
$$;

create or replace function public.leave_bet(p_bet_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.bet_positions
  where bet_id = p_bet_id and user_id = auth.uid();
$$;

-- Stop new joins without declaring a winner yet.
create or replace function public.lock_bet(p_bet_id uuid)
returns public.bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.bets;
begin
  update public.bets
  set status = 'locked'
  where id = p_bet_id
    and creator_id = auth.uid()
    and status = 'open'
  returning * into v_bet;

  if v_bet.id is null then
    raise exception 'Only the creator can lock an open bet'
      using errcode = 'insufficient_privilege';
  end if;

  return v_bet;
end;
$$;

create or replace function public.cancel_bet(p_bet_id uuid)
returns public.bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.bets;
begin
  update public.bets
  set status = 'cancelled'
  where id = p_bet_id
    and creator_id = auth.uid()
    and status in ('open', 'locked')
  returning * into v_bet;

  if v_bet.id is null then
    raise exception 'Only the creator can cancel a bet that has not resolved'
      using errcode = 'insufficient_privilege';
  end if;

  return v_bet;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------
-- Net balance per member of a group: every ledger line, adjusted by payments
-- already confirmed. Positive = the group owes them.
create or replace function public.group_balances(p_group_id uuid)
returns table (user_id uuid, amount_agorot bigint)
language sql
stable
security definer
set search_path = public
as $$
  with membership as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id = p_group_id
      and public.is_group_member(p_group_id)
  ),
  movements as (
    select e.user_id, e.amount_agorot::bigint as amount
    from public.bet_ledger_entries e
    where e.group_id = p_group_id

    union all

    -- Paying someone moves you towards zero from below.
    select s.from_user_id, s.amount_agorot::bigint
    from public.settlement_confirmations s
    where s.group_id = p_group_id

    union all

    select s.to_user_id, -s.amount_agorot::bigint
    from public.settlement_confirmations s
    where s.group_id = p_group_id
  )
  select m.user_id, coalesce(sum(mv.amount), 0)::bigint
  from membership m
  left join movements mv on mv.user_id = m.user_id
  group by m.user_id;
$$;

-- ---------------------------------------------------------------------------
-- Profile stats
-- ---------------------------------------------------------------------------
create or replace function public.my_stats()
returns table (
  total_won_agorot bigint,
  total_lost_agorot bigint,
  bets_won integer,
  bets_lost integer,
  bets_settled integer,
  most_active_group_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select e.*
    from public.bet_ledger_entries e
    where e.user_id = auth.uid()
  ),
  activity as (
    select p.bet_id, b.group_id
    from public.bet_positions p
    join public.bets b on b.id = p.bet_id
    where p.user_id = auth.uid()
  )
  select
    coalesce(sum(amount_agorot) filter (where amount_agorot > 0), 0)::bigint,
    coalesce(-sum(amount_agorot) filter (where amount_agorot < 0), 0)::bigint,
    count(*) filter (where amount_agorot > 0)::int,
    count(*) filter (where amount_agorot < 0)::int,
    count(*)::int,
    (
      select a.group_id
      from activity a
      group by a.group_id
      order by count(*) desc, a.group_id
      limit 1
    )
  from mine;
$$;

-- ---------------------------------------------------------------------------
-- Push tokens
-- ---------------------------------------------------------------------------
create or replace function public.set_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.users
  set expo_push_token = nullif(trim(p_token), '')
  where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.generate_invite_code() from public, anon, authenticated;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group_with_code(text) to authenticated;
grant execute on function public.join_bet(uuid, text) to authenticated;
grant execute on function public.leave_bet(uuid) to authenticated;
grant execute on function public.lock_bet(uuid) to authenticated;
grant execute on function public.cancel_bet(uuid) to authenticated;
grant execute on function public.group_balances(uuid) to authenticated;
grant execute on function public.my_stats() to authenticated;
grant execute on function public.set_push_token(text) to authenticated;
