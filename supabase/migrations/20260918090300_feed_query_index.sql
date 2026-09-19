-- The index the feed's own query has never had.
--
-- `fetchFeedBets` is the single most-run query in the app — every launch,
-- every tab focus, every return from the background, and every realtime event
-- that cannot be patched in place. It is exactly:
--
--   select … from bets
--    where status in ('open','locked')
--    order by created_at desc
--    limit 100
--
-- and nothing in the schema served it. `EXPLAIN (ANALYZE)` against the live
-- project:
--
--   Limit  (actual time=1.316..1.320 rows=18)
--     ->  Sort  (Sort Key: created_at DESC)
--           ->  Seq Scan on bets  (Filter: status = ANY ('{open,locked}'))
--
-- A sequential scan and a full sort, to return a page of 100. It is two
-- milliseconds today because the table holds 29 rows, which is precisely why
-- it went unnoticed — and precisely the shape that stops being free. Both the
-- scan and the sort grow with every bet ever posted, including the resolved
-- and cancelled ones the feed will never show.
--
-- `bets_status_idx` on `(status)` does not help. Status has four values and
-- most rows are one of the two this query wants, so the planner is right to
-- ignore it — and it offers nothing for the ORDER BY, which is where the real
-- work is.
--
-- **Partial, on the ordering column.** `where status in ('open','locked')`
-- means the index only holds live bets, so it stays roughly constant-sized
-- while the table grows: a bet leaves the index the moment it is resolved or
-- cancelled. And because the index is itself ordered by `created_at desc`, the
-- limit becomes a walk of the first 100 entries with no sort at all.
--
-- The predicate is written to match the client's `.in('status', [...])` call
-- exactly. Postgres only uses a partial index when it can prove the query's
-- WHERE implies the index's, so this has to stay in step with `fetchFeedBets`
-- — if that list of statuses ever changes, this comes with it or the index
-- silently stops being used.
create index if not exists bets_feed_idx
  on public.bets (created_at desc)
  where status in ('open', 'locked');

comment on index public.bets_feed_idx is
  'Serves fetchFeedBets: status in (open, locked) ordered by created_at desc. '
  'Partial so it holds only live bets and does not grow with settled history. '
  'Keep the predicate in step with the status filter in queries.ts.';
