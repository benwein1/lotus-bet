-- The index behind "bets you started".
--
-- The Profile screen now shows a grid of the bets somebody posted, which is a
-- lookup by `creator_id` — and `bets` had no index on that column. Every other
-- access path did: `(group_id, created_at desc)` for the group screen and
-- `(status)` for the feed. This one was missing because until now nothing ever
-- asked the question.
--
-- Ordered by `created_at desc` inside the index, because that is the order the
-- grid draws in and it saves the sort.
create index if not exists bets_creator_created_idx
  on public.bets (creator_id, created_at desc);
