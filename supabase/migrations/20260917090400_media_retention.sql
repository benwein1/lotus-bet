-- Media on cancelled bets does not live forever.
--
-- SCALEABILITY.md §4 item 4 asks for a retention policy "before you need one",
-- and this is the half of it that is uncontroversial: **nothing is owed on a
-- cancelled bet**, so its photos are not evidence of anything and nobody loses
-- a record by their going.
--
-- Deliberately **only** cancelled bets. The same section suggests archiving
-- attachments on bets resolved over a year ago, and that is a different
-- question with a different answer — proof of outcome is evidence somebody may
-- want to keep, and a year is not obviously long enough to stop caring about
-- who won. Left alone on purpose rather than forgotten.
--
-- This function only names what is sweepable. Deleting the bytes needs the
-- Storage API, which SQL has no reach into — that is the `sweep-media` Edge
-- Function, which deletes the objects first and the rows second. If it dies in
-- between, the row is still here and the next run finds it again; the reverse
-- order would strand bytes nothing points at.

create or replace function public.sweepable_media(p_older_than interval default interval '30 days')
returns table (id uuid, storage_path text, bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.storage_path, m.bytes
  from public.bet_media m
  join public.bets b on b.id = m.bet_id
  where b.status = 'cancelled'
    -- Cancelled bets have no `cancelled_at`, so the bet's own age is the
    -- clock. It is an over-estimate of how long ago it was cancelled, which
    -- errs towards keeping things — the right direction for a delete.
    and b.created_at < now() - p_older_than
  order by m.created_at;
$$;

comment on function public.sweepable_media(interval) is
  'Media attached to bets cancelled longer than the given age. Names what may '
  'go; the sweep-media Edge Function removes the objects and then the rows.';

-- It lists storage paths across every group, so it is exactly as service-role
-- as the push-target functions are.
revoke execute on function public.sweepable_media(interval) from public, anon, authenticated;
grant execute on function public.sweepable_media(interval) to service_role;
