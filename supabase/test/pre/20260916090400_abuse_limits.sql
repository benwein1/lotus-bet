-- Planted immediately before `…_abuse_limits.sql`.
--
-- That migration clamps over-long display names before adding the `check` that
-- forbids them. Against an empty database the clamp is a no-op that passes for
-- the wrong reason — CLAUDE.md §7 — so this puts the shape it is about into
-- the table: one name past 40 characters and one that is only whitespace.
--
-- Inserted straight into `public.users` rather than through `auth.users`,
-- because the signup trigger would generate a sane name and there would be
-- nothing to clamp.
insert into public.users (id, email, display_name, profile_completed)
values
  (
    '44444444-0000-4000-8000-000000000001',
    'toolong@example.com',
    'This display name is considerably longer than forty characters and should be clamped',
    true
  ),
  (
    '44444444-0000-4000-8000-000000000002',
    'blank@example.com',
    '   ',
    true
  )
on conflict (id) do nothing;
