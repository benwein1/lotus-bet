-- One push token per device, instead of one per person.
--
-- `users.expo_push_token` is a single column, so signing in on a second device
-- silently overwrites the first and the first stops receiving anything, with no
-- error anywhere. SCALEABILITY.md §7 files this under scale and then says the
-- important part: it is a **correctness** bug that presents as a scale bug. It
-- does not degrade gradually — it halves your notification reach the moment
-- somebody owns two devices, and nobody reports a notification that never
-- arrived.
--
-- The column stays. Accounts that have not reopened the app since this
-- migration still have a token in it and still need telling, so both are read
-- until the app has had a release to migrate everybody. `set_push_token` writes
-- both.

create table if not exists public.user_devices (
  -- The token *is* the device, as far as Expo is concerned. Making it the
  -- primary key is what makes a device changing hands work: signing in as
  -- somebody else re-points the same token at the new owner rather than
  -- leaving a stale row that would notify the wrong person.
  token text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  platform text check (platform in ('ios', 'android', 'web')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists user_devices_user_id_idx on public.user_devices (user_id);

comment on table public.user_devices is
  'Push tokens, one row per device. Written only by set_push_token; never '
  'readable by a client — a group member must not be able to list their '
  'friends'' devices.';

-- ---------------------------------------------------------------------------
-- Nobody reads this table but the server
-- ---------------------------------------------------------------------------
-- RLS on, and deliberately **no policies at all**: every policy-less table
-- matches zero rows for a client, which is exactly right here. Writes go
-- through `set_push_token`, which is `security definer` and owns the shape.
--
-- The grants are revoked as well as the policies withheld, because
-- SECURITY.md records the lesson: a blanket grant applied after a migration
-- silently re-opened a function that had been locked down. Two locks on the
-- same door is the cheapest insurance in this schema.
alter table public.user_devices enable row level security;
revoke all on public.user_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registering a device
-- ---------------------------------------------------------------------------
create or replace function public.set_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(trim(p_token), '');
begin
  if auth.uid() is null then
    return;
  end if;

  if v_token is null then
    -- Turning notifications off means off, on this device. Other devices this
    -- person owns keep working, which is the whole point of the table — the
    -- switch is on a phone, not on an account.
    delete from public.user_devices where user_id = auth.uid();
    update public.users set expo_push_token = null where id = auth.uid();
    return;
  end if;

  insert into public.user_devices (token, user_id, platform, last_seen_at)
  values (v_token, auth.uid(), nullif(trim(p_platform), ''), now())
  on conflict (token) do update
    set user_id      = excluded.user_id,
        platform     = coalesce(excluded.platform, public.user_devices.platform),
        last_seen_at = now();

  -- Kept in step for one release, so an account that has not reopened the app
  -- is still reachable through the old column.
  update public.users set expo_push_token = v_token where id = auth.uid();
end;
$$;

-- **One function with a default, not two overloads.** The first version of this
-- migration kept a one-argument `set_push_token(text)` alongside the new
-- two-argument one, so that an installed build calling the old signature kept
-- working. Postgres then could not choose between them — `set_push_token('')`
-- is a candidate for both — and every call failed with "function
-- public.set_push_token(unknown) is not unique". That would have broken
-- notifications for *everyone*, which is the failure this migration exists to
-- fix, in the name of compatibility it did not actually provide.
--
-- A default does the compatibility properly: PostgREST resolves a call that
-- names only `p_token` to this same function, so an old build keeps working and
-- there is nothing to disambiguate.
drop function if exists public.set_push_token(text);

grant execute on function public.set_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Every token a person can be reached on
-- ---------------------------------------------------------------------------
-- One place that answers "where does this person get notified", so the two
-- fan-out functions below do not each carry a copy of the union.
create or replace function public.push_tokens_for(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select d.token from public.user_devices d where d.user_id = p_user
  union
  select u.expo_push_token
    from public.users u
   where u.id = p_user
     and u.expo_push_token is not null
     and u.expo_push_token <> '';
$$;

-- Same reasoning as the two below: this returns device tokens.
revoke execute on function public.push_tokens_for(uuid) from public, anon, authenticated;
grant execute on function public.push_tokens_for(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The fan-out, now one row per device rather than one per person
-- ---------------------------------------------------------------------------
-- The shape is unchanged — `(user_id, expo_push_token)` — so the `notify` Edge
-- Function needs no change. It simply receives two rows for somebody with two
-- phones, which is the fix.
--
-- The `expo_push_token is not null` guards are gone: a lateral over
-- `push_tokens_for` yields nothing for somebody with no devices, so they drop
-- out of the result on their own.
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
  select u.id, t.token
  from public.bets b
  join public.group_members gm on gm.group_id = b.group_id
  join public.users u on u.id = gm.user_id
  cross join lateral public.push_tokens_for(u.id) as t(token)
  where b.id = p_bet_id
    and u.id is distinct from p_exclude
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
  select u.id, t.token
  from public.group_members gm
  join public.users u on u.id = gm.user_id
  cross join lateral public.push_tokens_for(u.id) as t(token)
  where gm.group_id = p_group_id
    and u.id is distinct from p_exclude
    and case p_kind
          when 'member_joined' then u.notify_group_joins
          else false
        end;
$$;

-- `create or replace` does not reset privileges, but these are the functions
-- SECURITY.md §2 specifically checks are unreachable from a signed-in client,
-- so they are restated rather than assumed.
revoke execute on function public.push_targets_for_bet(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.push_targets_for_group(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.push_targets_for_bet(uuid, text, uuid) to service_role;
grant execute on function public.push_targets_for_group(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Deleting an account takes its devices with it
-- ---------------------------------------------------------------------------
-- The foreign key cascades from `public.users`, but `delete_account` does not
-- delete that row — it scrubs it and sets `deleted_at`, because the ledger has
-- to survive somebody leaving (CLAUDE.md §6). So the cascade never fires for
-- the one case that matters most.
--
-- A trigger rather than a line inside `delete_account`: rewriting that function
-- here would mean restating a body this migration has no business owning, and
-- CLAUDE.md §6 records what happens when a `create or replace` is written from
-- a stale copy — the username assignment went missing exactly that way.
create or replace function public.forget_devices_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_devices where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists users_forget_devices on public.users;
create trigger users_forget_devices
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.forget_devices_on_delete();
