-- In-app account deletion.
--
-- Guideline 5.1.1(v): "If your app supports account creation, you must also
-- offer account deletion within the app." There was no delete path at all —
-- no RPC, no UI, no column. It is an automatic rejection.
--
-- ---------------------------------------------------------------------------
-- Why this cannot simply be `delete from auth.users`
-- ---------------------------------------------------------------------------
-- Because of one foreign-key chain:
--
--   bet_ledger_entries.user_id -> public.users.id   ON DELETE CASCADE
--   public.users.id            -> auth.users.id     ON DELETE CASCADE
--
-- So deleting the auth row cascades all the way through the ledger. And the
-- ledger is not this person's private history — `group_balances` sums those
-- signed rows to work out what **everyone else** in the group owes. Removing
-- them does not erase one person's data; it silently changes what four other
-- people owe each other, in a direction that happens to favour whoever left.
-- An app whose entire job is recording who owes whom cannot offer a delete
-- button that is also a way to clear your debts.
--
-- So the rule is **scrub, don't erase**:
--
--   * The `auth.users` row is genuinely deleted. The account cannot sign in,
--     and the email address is freed for re-registration. That is what makes
--     this a real deletion rather than a disable.
--   * The `public.users` row survives as a tombstone with every personal field
--     removed, so the rows that point at it still resolve to *somebody* and
--     balances stay arithmetically true. It renders as "Deleted account".
--   * Everything that is this person's own speech or activity — comments,
--     likes, blocks, positions on bets that have not been called yet — goes.
--
-- Which means the cascade between the two tables has to be broken first, or
-- the tombstone dies with the auth row.

-- ---------------------------------------------------------------------------
-- Break the cascade
-- ---------------------------------------------------------------------------
-- `public.users.id` keeps mirroring `auth.users.id` — every RLS policy in the
-- schema compares it against `auth.uid()` and that does not change. What goes
-- is the constraint that deletes the row when the auth row goes.
--
-- Losing referential integrity here is the point, not a side effect: a
-- tombstone is *defined* as a profile row with no account behind it.
alter table public.users
  drop constraint if exists users_id_fkey;

-- When the profile was scrubbed. Null for a live account; the app reads it to
-- render the row as "Deleted account" rather than as a person with a strange
-- name.
alter table public.users
  add column if not exists deleted_at timestamptz;

-- Readable, never writable. `…_user_column_privileges.sql` revoked the blanket
-- grant on this table, so a column added afterwards has to name itself or the
-- client cannot see it — and the app needs it to render "Deleted account"
-- instead of a person. It is deliberately absent from the UPDATE grant: only
-- `delete_account()` sets it, so no client can tombstone anybody, itself
-- included.
grant select (deleted_at) on public.users to authenticated;

comment on column public.users.deleted_at is
  'Set by delete_account(). The auth.users row is gone; this row survives so '
  'bet_ledger_entries still resolves and group balances stay correct.';

-- ---------------------------------------------------------------------------
-- The deletion itself
-- ---------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Bets this person created and never called. Nobody else can resolve them,
  -- so leaving them open would strand everyone who took a side — their money
  -- committed to a question that can never be answered. Cancelling is what the
  -- creator would have had to do, and it writes no ledger rows.
  update public.bets
     set status = 'cancelled'
   where creator_id = v_me
     and status in ('open', 'locked');

  -- Positions on bets that are still open. A resolved bet's positions are the
  -- evidence behind its ledger rows and stay; an open bet's are a live
  -- commitment this person is no longer around to honour.
  --
  -- The `enforce_bet_open` trigger refuses a delete on anything else anyway,
  -- which is why the filter is here rather than left to cascade.
  delete from public.bet_positions p
   where p.user_id = v_me
     and exists (
       select 1 from public.bets b
       where b.id = p.bet_id and b.status = 'open'
     );

  -- Their speech. A comment is not a record anybody else's balance depends on.
  delete from public.bet_comments where user_id = v_me;
  delete from public.bet_likes where user_id = v_me;

  -- Blocks in both directions: theirs are preferences that no longer have an
  -- owner, and a block *on* an account that cannot sign in protects nobody.
  delete from public.user_blocks
   where blocker_id = v_me or blocked_id = v_me;

  -- Media they uploaded. The `bet_media` rows go; the objects in the bucket do
  -- not, because storage is not reachable from SQL. That cleanup belongs to a
  -- scheduled job and is written down in SECURITY.md rather than pretended at
  -- here.
  delete from public.bet_media where uploaded_by = v_me;

  -- The scrub. Every personal field, plus the handle — releasing the username
  -- matters because it is how somebody is challenged, and a dead account
  -- holding a name nobody can reach is a small permanent tax on everyone else.
  update public.users
     set display_name     = 'Deleted account',
         email            = null,
         phone            = null,
         username         = null,
         avatar_url       = null,
         expo_push_token  = null,
         notify_new_bets  = false,
         notify_resolutions = false,
         notify_group_joins = false,
         notify_deadlines = false,
         profile_completed = false,
         deleted_at       = now()
   where id = v_me;

  -- Last, because everything above uses `auth.uid()`. Once this row is gone
  -- the session is dead on its next refresh, and the email is free again.
  delete from auth.users where id = v_me;
end;
$$;

grant execute on function public.delete_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Group memberships are deliberately kept
-- ---------------------------------------------------------------------------
-- Removing them would be tidier and is wrong. `shares_group_with` is what lets
-- everyone else read the tombstone's name, and it reads `group_members` — so
-- deleting the membership makes the person behind a balance line unrenderable.
-- The settle-up screen would show an amount owed to nobody.
--
-- A "Deleted account" row in a group's member list is honest. A blank name on
-- a debt is not.
