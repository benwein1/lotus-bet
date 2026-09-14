-- Applied immediately before 20260913090000_proof_media.sql.
--
-- Plants media in the shape the table had *before* `purpose` existed, so the
-- migration has real rows to give a default to. Against an empty table the new
-- column is a no-op that passes for the wrong reason — the same trap the bet
-- options migration fell into, which is why `pre/` exists at all.
--
-- It hangs off the world the *options* pre-fixture already built
-- (`11111111-…`), rather than the main fixture: `pre/` files run during the
-- migration pass, and `10_fixture.sql` has not been applied yet at this point.
-- That ordering is the whole reason a first attempt at this file silently
-- inserted nothing.

-- An attachment on a bet that is still open — the ordinary case, and the only
-- one the old policy could produce.
insert into public.bet_media (
  id, bet_id, group_id, uploaded_by, kind, storage_path, width, height, position
)
values (
  '00000000-0000-4000-8000-0000000000e1',
  '11111111-0000-4000-8000-00000000000a',
  '11111111-0000-4000-8000-000000000000',
  '11111111-1111-4000-8000-000000000001',
  'image',
  '11111111-0000-4000-8000-000000000000/11111111-0000-4000-8000-00000000000a/legacy-photo.jpg',
  1200, 1500, 0
)
on conflict (id) do nothing;

-- And one on a bet that has already been resolved, to prove the default does
-- not care about status: every pre-existing row is an attachment regardless of
-- what its bet went on to do. Without this, the migration would look correct
-- even if it had somehow keyed the default off the bet's state.
insert into public.bet_media (
  id, bet_id, group_id, uploaded_by, kind, storage_path, duration_ms, position
)
values (
  '00000000-0000-4000-8000-0000000000e2',
  '11111111-0000-4000-8000-00000000000c',
  '11111111-0000-4000-8000-000000000000',
  '11111111-1111-4000-8000-000000000001',
  'video',
  '11111111-0000-4000-8000-000000000000/11111111-0000-4000-8000-00000000000c/legacy-clip.mp4',
  8000, 0
)
on conflict (id) do nothing;
