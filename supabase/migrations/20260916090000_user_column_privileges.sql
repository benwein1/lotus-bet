-- Every group member could read every other member's email, phone number and
-- push token. This closes that.
--
-- SECURITY.md finding #1. The cause is that **RLS is row-level**, and the
-- policy on `public.users` is written at exactly that grain:
--
--   using (id = auth.uid() or public.shares_group_with(id))
--
-- Which is the correct rule for *whether you may see this person at all*, and
-- says nothing about *which of their columns*. The table then accumulated
-- sensitive columns across four migrations — `email` and `phone` from the auth
-- work, `expo_push_token` from notifications — while `queries.ts` kept asking
-- for `users(*)` in four places. So joining a group handed you the email
-- address, phone number and device push token of everyone already in it.
--
-- None of that is hypothetical: a group is the app's only trust boundary, and
-- an invite link is a door anyone can be handed. A push token in particular is
-- a capability, not an identifier — it is the address notifications are
-- delivered to.
--
-- The fix is the other half of the privilege system. RLS decides which *rows*;
-- `GRANT ... (column_list)` decides which *columns*. Postgres checks both, and
-- column privileges are what this table has been missing.
--
-- Three consequences worth knowing before reading the grants:
--
--   1. `select *` **fails outright** for a role without SELECT on every
--      column — "permission denied for column email" — rather than quietly
--      returning fewer columns. That is the behaviour we want (a silent
--      narrowing is how a leak comes back), and it is why this migration ships
--      alongside the client change that names columns at all six read sites.
--      A client older than this migration stops reading `users` entirely
--      rather than degrading; that is the safe direction.
--
--   2. `SECURITY DEFINER` functions run as the owner and are unaffected.
--      `handle_new_auth_user` still seeds `email`, `suggest_username` still
--      reads it, and `push_targets_for_bet` / `push_targets_for_group` still
--      return `expo_push_token` to the service role. The push fan-out keeps
--      working, and it remains the *only* way to reach a token — which is what
--      those functions being revoked from `authenticated` was always for.
--
--   3. The user's own email is not lost to the app. It is in the GoTrue
--      session (`session.user.email`) — the authoritative copy, which
--      `public.users.email` was only ever a mirror of. The profile screen
--      reads it from there now.

-- ---------------------------------------------------------------------------
-- Start from nothing
-- ---------------------------------------------------------------------------
-- Supabase hands `anon` and `authenticated` blanket table privileges through
-- default privileges, so the grants below are only meaningful after the
-- blanket ones are taken away. Revoking the table-level privilege does not
-- touch column-level ones, hence revoking both.
revoke all on public.users from anon;
revoke all on public.users from authenticated;

-- ---------------------------------------------------------------------------
-- What a signed-in client may read
-- ---------------------------------------------------------------------------
-- Everything needed to *render a person*: their name, their handle, their
-- face. Plus the four notification preferences and `profile_completed`, which
-- are the user's own settings and are read back on the Profile screen.
--
-- Those five are readable by a groupmate as well, because a column grant
-- cannot distinguish "your row" from "their row" — only RLS can, and it has
-- already decided you may see the row. That is an accepted trade: knowing
-- whether somebody has notifications switched on is not a capability, and
-- keeping the split at the column level is what makes the rule auditable.
-- The three that *are* sensitive are simply not here.
--
-- Deliberately absent: `email`, `phone`, `expo_push_token`.
grant select (
  id,
  display_name,
  username,
  avatar_url,
  profile_completed,
  notify_new_bets,
  notify_resolutions,
  notify_group_joins,
  notify_deadlines,
  created_at
) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- What a signed-in client may write
-- ---------------------------------------------------------------------------
-- `users_update_self` already restricts this to your own row. The column list
-- restricts it to the fields the app actually edits — which closes a second,
-- quieter hole: until now a client could `update` its own `email` to any
-- string, desynchronising `public.users.email` from the `auth.users` row that
-- actually governs signing in. And it could overwrite its own
-- `expo_push_token`, which `set_push_token` exists to own.
grant update (
  display_name,
  avatar_url,
  profile_completed,
  notify_new_bets,
  notify_resolutions,
  notify_group_joins,
  notify_deadlines
) on public.users to authenticated;

-- The row itself is created by the `handle_new_auth_user` trigger, which runs
-- as the owner. This grant exists only so the `users_insert_self` policy
-- retains a path for a client completing its own profile against an older
-- project, and it names the three columns such a client could legitimately
-- supply.
grant insert (
  id,
  display_name,
  avatar_url
) on public.users to authenticated;

-- `anon` gets nothing at all. RLS already denied it every row — `auth.uid()`
-- is null, so neither branch of the policy can be true — but a table with
-- sensitive columns should not be relying on a single mechanism.
