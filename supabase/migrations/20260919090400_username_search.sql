-- Prefix search over usernames, for the challenge screen's autocomplete.
--
-- ---------------------------------------------------------------------------
-- This reverses a documented decision. Read this before extending it.
-- ---------------------------------------------------------------------------
-- CLAUDE.md §1 says, in as many words: "Looking somebody up is exact-handle
-- only, and that is a security property, not a missing feature: a prefix or
-- fuzzy search over `users` is an endpoint anyone could walk to harvest every
-- account."
--
-- That is still true. The owner's decision is that autocomplete is worth it,
-- and it is a real product call — an exact-handle field means you cannot
-- challenge anybody whose handle you cannot spell, which is most people.
--
-- So this exists, and it is built to give away as little as a prefix search
-- can:
--
--   * **Prefix only, never contains.** `like 'bar%'` and not `like '%bar%'`.
--     A contains-search lets two characters enumerate most of the table; a
--     prefix search makes the caller guess the beginning, which is the part
--     they plausibly already know.
--   * **A floor on the query.** Under two characters returns nothing at all,
--     so `a`, `b`, `c` cannot be walked to page through everybody.
--   * **Ten rows, hard.** Enough for a dropdown, useless as an export.
--   * **Handle, name and avatar only.** No email, no id-adjacent data beyond
--     the id itself, which is needed to start the duel and is already exposed
--     to anyone who shares a group with them.
--   * **Deleted accounts are excluded**, so a tombstone cannot be challenged
--     or counted.
--
-- What this does NOT do is rate-limit. `…_abuse_limits.sql` guards writes; a
-- read has no equivalent here, so a determined caller can still page the
-- namespace prefix by prefix. If that becomes a problem the fix is a rate
-- limit on this function, not a narrower result set.

create or replace function public.search_users_by_username(p_query text)
returns table (id uuid, display_name text, username text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.display_name, u.username, u.avatar_url
  from public.users u
  where u.username is not null
    and u.deleted_at is null
    and u.id <> auth.uid()
    -- Two characters minimum. Below that the result is deliberately empty
    -- rather than "everybody whose handle starts with a".
    and length(trim(coalesce(p_query, ''))) >= 2
    -- Prefix, not contains. `like` with a leading wildcard would also refuse
    -- to use the index below, so this is the fast shape as well as the
    -- conservative one.
    and lower(u.username) like lower(trim(p_query)) || '%'
  -- Shortest first: somebody typing "bar" almost always wants `bar` before
  -- `barnaby_the_third`, and it makes the list order stable rather than
  -- whatever the planner returns.
  order by length(u.username), u.username
  limit 10;
$$;

comment on function public.search_users_by_username(text) is
  'Prefix autocomplete for the challenge screen. Prefix-only, two-character '
  'minimum, ten rows. See the head of 20260919090400_username_search.sql for '
  'what this deliberately gives up.';

-- CLAUDE.md §10: every new function in `public` needs its own explicit revoke,
-- because the platform re-grants execute on newly created objects.
revoke execute on function public.search_users_by_username(text) from public, anon;
grant execute on function public.search_users_by_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The index the prefix search needs
-- ---------------------------------------------------------------------------
-- `lower(username) like 'bar%'` can only use an index built on the same
-- expression, and only with `text_pattern_ops` — the default opclass sorts by
-- collation and will not serve a prefix match. Without this the autocomplete
-- is a sequential scan on every keystroke, which is exactly the shape of load
-- a debounce is meant to avoid and cannot.
create index if not exists users_username_prefix_idx
  on public.users (lower(username) text_pattern_ops)
  where username is not null and deleted_at is null;
