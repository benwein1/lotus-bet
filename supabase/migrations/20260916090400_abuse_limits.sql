-- Rate limits, and two constraints the database was trusting the client for.
--
-- SECURITY.md finding #2 (HIGH) and finding #10 (INFO), plus the half of #5
-- that is a row constraint rather than bucket configuration.
--
-- The thing finding #2 is actually about: every vector in that table is an
-- authenticated user with a valid JWT making **ordinary, policy-compliant
-- requests** as fast as they like. RLS has nothing to say about it — every one
-- of those inserts is allowed. Rate is a different axis from permission, and
-- nothing in this schema was measuring it.
--
-- These live in the database rather than in `queries.ts` for the reason
-- SECURITY.md gives: a limit in the client is a suggestion. The anon key and
-- the REST endpoint are public by design, so anything that matters has to be
-- enforced where a modified client cannot reach it.

-- ---------------------------------------------------------------------------
-- One throttle, parameterised per table
-- ---------------------------------------------------------------------------
-- One function rather than four near-identical ones, so there is a single
-- place to audit and the numbers live on the trigger definitions where they
-- are easy to read and change.
--
-- The dynamic SQL is safe: `tg_table_name` comes from Postgres and the column
-- name comes from `tg_argv`, which is written in this file — neither is user
-- input — and both go through `%I` regardless.
create or replace function public.enforce_write_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_column text := tg_argv[0];
  v_limit int := tg_argv[1]::int;
  v_window interval := tg_argv[2]::interval;
  v_count int;
begin
  -- No `auth.uid()` means this is not a client: the service role, a migration,
  -- the seed script, or the push fan-out. Throttling those would break
  -- deployment and notification delivery to solve a problem they do not have.
  -- It is also not a hole — reaching this path already requires a key that
  -- bypasses RLS entirely.
  if v_me is null then
    return new;
  end if;

  execute format(
    'select count(*) from public.%I where %I = $1 and created_at > now() - $2',
    tg_table_name,
    v_column
  )
  into v_count
  using v_me, v_window;

  if v_count >= v_limit then
    -- 53400 is `configuration_limit_exceeded`. PostgREST maps it to 500 rather
    -- than 429, which is not ideal, but the message is what the user sees and
    -- it says the right thing.
    raise exception 'Slow down. That is % in %, which is the limit.', v_limit, v_window
      using errcode = '53400';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The numbers
-- ---------------------------------------------------------------------------
-- Set well above what the app is *for* and well below what abuse needs. A
-- loud argument in a group thread is the normal case this must not break, so
-- the comment limit is deliberately generous: thirty in an hour is a
-- conversation, a hundred is a script.
drop trigger if exists bet_comments_rate_limit on public.bet_comments;
create trigger bet_comments_rate_limit
  before insert on public.bet_comments
  for each row execute function public.enforce_write_rate('user_id', '30', '1 hour');

drop trigger if exists bets_rate_limit on public.bets;
create trigger bets_rate_limit
  before insert on public.bets
  for each row execute function public.enforce_write_rate('creator_id', '15', '1 hour');

drop trigger if exists groups_rate_limit on public.groups;
create trigger groups_rate_limit
  before insert on public.groups
  for each row execute function public.enforce_write_rate('created_by', '5', '1 day');

-- Media is the expensive one. SECURITY.md names it the most dangerous vector
-- in the table: a 1 GB bucket filled by one account takes down every group's
-- photos, not just theirs. Forty a day is more than anybody posts and far
-- less than a script needs.
drop trigger if exists bet_media_rate_limit on public.bet_media;
create trigger bet_media_rate_limit
  before insert on public.bet_media
  for each row execute function public.enforce_write_rate('uploaded_by', '40', '1 day');

-- ---------------------------------------------------------------------------
-- A storage path must live under the group it claims to belong to
-- ---------------------------------------------------------------------------
-- Finding #5, the half that is a row constraint. The insert policy already
-- checks `group_id` against the bet's group, but said nothing about
-- `storage_path` — so a member could file a row in their own group pointing at
-- `<someone else's group>/…`. The bucket policies read the group out of the
-- first path segment and would refuse the object itself, so this was never a
-- read of another group's media; it was a row whose path disagreed with its
-- own `group_id`, which is the kind of mismatch that turns into a bug the
-- first time anything trusts one and not the other.
--
-- `media.ts` builds every path as `<group_id>/<bet_id>/<file>`, so existing
-- rows satisfy this by construction.
alter table public.bet_media
  drop constraint if exists bet_media_path_under_group;
alter table public.bet_media
  add constraint bet_media_path_under_group
  check (storage_path like group_id::text || '/%');

-- ---------------------------------------------------------------------------
-- A display name has a length
-- ---------------------------------------------------------------------------
-- Finding #10. Every other user-written string in the schema already has a
-- `check` — group names, bet titles, descriptions, option labels, comment
-- bodies — and `display_name` is the one that does not, despite being the
-- string that appears on the most screens. `maxLength={40}` in the input is a
-- client-side courtesy; a modified client can store any length.
--
-- Existing rows are clamped first so the constraint can be added validated
-- rather than `not valid`. A `not valid` constraint would leave exactly the
-- rows this is about — the ones already too long — permanently exempt.
update public.users
   set display_name = left(trim(display_name), 40)
 where char_length(trim(display_name)) > 40;

-- An all-whitespace name would fail the lower bound. Nothing can create one
-- today, but the clamp above cannot produce a valid name from one either.
update public.users
   set display_name = 'Player ' || right(id::text, 4)
 where trim(display_name) = '';

alter table public.users
  drop constraint if exists users_display_name_length;
alter table public.users
  add constraint users_display_name_length
  check (char_length(trim(display_name)) between 1 and 40);

-- ---------------------------------------------------------------------------
-- Deliberately NOT done here: finding #7
-- ---------------------------------------------------------------------------
-- SECURITY.md proposes restricting `group_invites` SELECT to
-- `is_group_admin(group_id)`, so an ordinary member cannot read the live token
-- and re-share it. That fix does not work against this product.
--
-- `create_group_invite` requires only `is_group_member`, so any member can
-- mint a fresh, working link whenever they like. Hiding the existing token
-- from them removes no capability they do not already have — it only breaks
-- the group screen's live-link display for non-admins. The invite migration
-- says as much where it grants minting to members: making links admin-only
-- "would be a different, stricter product than the one that already shipped".
--
-- The coherent options are to leave both open (today) or to make minting *and*
-- reading admin-only (a product decision, not a patch). Doing only the SELECT
-- half is the worst of the three.
