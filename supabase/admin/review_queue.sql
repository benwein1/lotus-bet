-- ===========================================================================
-- The moderation queue, as things to paste.
--
-- Guideline 1.2 asks for a timely response to reports, and the terms published
-- in `legal-text.json` promise 24 hours. This is the tool for keeping that
-- promise until there is a surface worth building.
--
-- Run these in the Supabase SQL editor, where you are already the owner. The
-- two functions are revoked from `authenticated`, so there is no way to reach
-- them from the app — `review_queue` returns other people's private group
-- content, and `review_report` deletes things.
--
-- Requires `20260917090300_moderation_review.sql`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What is waiting
-- ---------------------------------------------------------------------------
-- `content` is the actual comment, bet title or display name that was
-- reported, resolved from whichever table `target_kind` points at.
-- `target_exists` is false when it has already been deleted — which is the case
-- worth looking at hardest, because removing the evidence is the obvious first
-- move.
select
  id,
  created_at,
  reason,
  target_kind,
  reporter,
  reported,
  content,
  target_exists
from public.review_queue('open');

-- Everything, including what has been handled:
--   select * from public.review_queue(null) order by created_at desc;

-- ---------------------------------------------------------------------------
-- 2. How often, and about whom
-- ---------------------------------------------------------------------------
-- One report is a disagreement. Five about the same person is a pattern, and
-- the pattern is the thing a queue is bad at showing you.
select reported, count(*) as reports, min(created_at) as first_seen
from public.review_queue(null)
where reported <> 'deleted account'
group by reported
having count(*) > 1
order by count(*) desc;

-- ---------------------------------------------------------------------------
-- 3. Acting on one
-- ---------------------------------------------------------------------------
-- The outcome and the takedown are one call, because they are one decision.
-- Any other open report about the same content is closed with it, so the same
-- comment is not read five times.
--
--   -- Breaks the rules: remove it and say so.
--   select public.review_report(
--     '<report id>', 'actioned', true, 'Harassment. Comment removed.');
--
--   -- Looked at, nothing wrong with it.
--   select public.review_report('<report id>', 'dismissed', false, 'Not abusive.');
--
--   -- Seen, needs watching, content stays up for now.
--   select public.review_report('<report id>', 'reviewed', false, 'Borderline.');
--
-- A reported **bet is cancelled, never deleted** — deleting it would take its
-- positions and its ledger with it, and those are other people's record of what
-- they are owed. A reported **user** has nothing removed automatically;
-- suspending an account is a bigger lever than a report queue should pull by
-- itself (SECURITY.md section 7).

-- ---------------------------------------------------------------------------
-- 4. Are you keeping the promise?
-- ---------------------------------------------------------------------------
-- The number the terms committed you to. Anything in `overdue` is past 24
-- hours and unanswered.
select
  count(*) filter (where status = 'open')                                as open_now,
  count(*) filter (where status = 'open'
                     and created_at < now() - interval '24 hours')       as overdue,
  count(*) filter (where reviewed_at is not null
                     and reviewed_at - created_at < interval '24 hours') as answered_in_time,
  count(*) filter (where reviewed_at is not null
                     and reviewed_at - created_at >= interval '24 hours') as answered_late
from public.reports;
