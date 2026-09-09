-- Notification preferences, and the read a notifier needs to fan out.
--
-- Two switches existed from the start (new bets, resolutions). Two more are
-- added here so every notification the app can send is one the user can turn
-- off: somebody joining a group you are in, and a bet you have not answered
-- closing soon.
--
-- Both default to true. A default of false means the feature ships switched
-- off for everyone who already has an account, which reads as broken.

alter table public.users
  add column if not exists notify_group_joins boolean not null default true,
  add column if not exists notify_deadlines boolean not null default true;

comment on column public.users.notify_group_joins is
  'Push when somebody joins a group this user is in.';
comment on column public.users.notify_deadlines is
  'Schedule a local reminder before a bet this user has not answered closes.';

-- ---------------------------------------------------------------------------
-- Who to notify
-- ---------------------------------------------------------------------------
-- The `notify` Edge Function runs as the service role and could simply select
-- from `users`, but then the rule for "who hears about this" would live in
-- TypeScript, outside everything that tests the schema, and would drift from
-- the RLS that decides who can see the thing being announced.
--
-- These return push tokens only — never an email, a name or a row id beyond
-- the group membership the caller already had to be part of.

create or replace function public.push_targets_for_bet(
  p_bet_id uuid,
  p_kind text,
  p_exclude uuid
)
returns table (user_id uuid, expo_push_token text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.expo_push_token
  from public.bets b
  join public.group_members gm on gm.group_id = b.group_id
  join public.users u on u.id = gm.user_id
  where b.id = p_bet_id
    and u.id is distinct from p_exclude
    and u.expo_push_token is not null
    and u.expo_push_token <> ''
    and case p_kind
          when 'bet_created' then u.notify_new_bets
          -- A resolution only goes to people who actually took a side. The
          -- rest of the group never answered it and do not need telling.
          when 'bet_resolved' then u.notify_resolutions and exists (
            select 1 from public.bet_positions bp
            where bp.bet_id = b.id and bp.user_id = u.id
          )
          else false
        end;
$$;

create or replace function public.push_targets_for_group(
  p_group_id uuid,
  p_kind text,
  p_exclude uuid
)
returns table (user_id uuid, expo_push_token text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.expo_push_token
  from public.group_members gm
  join public.users u on u.id = gm.user_id
  where gm.group_id = p_group_id
    and u.id is distinct from p_exclude
    and u.expo_push_token is not null
    and u.expo_push_token <> ''
    and case p_kind
          when 'member_joined' then u.notify_group_joins
          else false
        end;
$$;

-- Only the service role fans out notifications. Leaving these callable by
-- `authenticated` would hand any group member a list of their friends' device
-- tokens, which is exactly the sort of thing a security definer function is
-- supposed to stop.
revoke execute on function public.push_targets_for_bet(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.push_targets_for_group(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.push_targets_for_bet(uuid, text, uuid) to service_role;
grant execute on function public.push_targets_for_group(uuid, text, uuid) to service_role;
