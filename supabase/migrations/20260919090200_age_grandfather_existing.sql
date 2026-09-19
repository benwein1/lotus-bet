-- Ask for a date of birth at signup only. Accounts that already existed are
-- grandfathered in and never see the check.
--
-- ---------------------------------------------------------------------------
-- This reverses a decision, on purpose, and it is worth saying why
-- ---------------------------------------------------------------------------
-- `…_minimum_age.sql` ends by refusing to backfill, and the reasoning there was
-- that a timestamp written by a migration is a record of the migration running
-- rather than of anybody confirming anything. That is still true, and it is
-- still the reason this file is a separate, named, deliberate step instead of
-- an edit to that one.
--
-- What changed is the product decision on top of it. The owner's call is that
-- the 16+ check belongs at signup and nowhere else: an established account
-- should not be interrupted to answer a question that did not exist when it was
-- made. That is a legitimate position — it is how most apps that add an age
-- floor handle the accounts already on the books — and it is the owner's to
-- make rather than this migration's.
--
-- So the honest framing is **grandfathering, not verification**. These accounts
-- have not been checked and this file does not pretend they have; it records
-- that they predate the rule and are exempt from it. The column is reused
-- because inventing a second one would mean every read site learning about two
-- kinds of "allowed to post", to carry a distinction nothing in the app acts on.
--
-- The consequence, stated plainly so nobody has to rediscover it: for the
-- accounts below, `age_verified_at` means "existed before the rule", and for
-- every account after them it means "gave a date of birth that passed". If a
-- future feature ever needs to tell those apart, the cutoff timestamp in this
-- file is the line.
--
-- ---------------------------------------------------------------------------
-- The cutoff is a literal, and that is the whole safety property
-- ---------------------------------------------------------------------------
-- Not `now()`, and not an unbounded `where age_verified_at is null`. Either of
-- those would grandfather whatever happens to be unstamped whenever this runs —
-- so re-running it, or applying it to a project that is behind, would silently
-- exempt accounts created *after* the rule, including every Apple and Google
-- signup waiting on the in-app check. A fixed timestamp cannot creep: it names
-- a set that stops growing the moment it is written.
--
-- 15:00Z on 2026-09-19 sits after the newest account on the production project
-- (13:15Z) and before the minimum-age rule began enforcing. On a fresh database
-- it matches nothing at all, which is correct — there is nothing to grandfather.

update public.users
   set age_verified_at = created_at
 where age_verified_at is null
   and created_at < timestamptz '2026-09-19 15:00:00+00';

-- `= created_at` rather than `= now()`, for the same reason the cutoff is a
-- literal. Stamping the moment the migration ran would put a 2026-09-19
-- timestamp on an account made in early September and make the column read as
-- "was checked today", which is the one thing that is definitely not true.
-- Using the account's own creation time keeps the row self-consistent: it says
-- this account has been allowed since it existed.

comment on column public.users.age_verified_at is
  'Non-null means this account may post. For accounts created before '
  '2026-09-19 15:00Z it means "predates the 16+ rule and is grandfathered in" '
  '(see 20260919090200_age_grandfather_existing.sql); for every account after '
  'that it means "gave a date of birth that passed the check". Set by the '
  'signup trigger or confirm_minimum_age(); never writable by a client, and '
  'the date of birth itself is never stored.';

-- ---------------------------------------------------------------------------
-- What is deliberately NOT changed
-- ---------------------------------------------------------------------------
-- Everything that makes the rule real stays exactly as it was:
--
--   * `handle_new_auth_user` still refuses an under-age signup outright, so no
--     new account can be created below the minimum.
--   * `require_age_verified()` still guards all six content tables, so an
--     unstamped account still cannot post.
--   * `confirm_minimum_age()` still exists and is still the only way for a
--     social signup to get stamped — Apple and Google return no date of birth,
--     so those accounts are created after the cutoff, are not grandfathered,
--     and see the in-app check exactly as before.
--
-- The gate is unchanged. Only its starting population is.
