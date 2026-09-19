-- Lifetime money totals, split by the currency they are denominated in.
--
-- ---------------------------------------------------------------------------
-- Why this exists at all
-- ---------------------------------------------------------------------------
-- `my_stats()` sums `bet_ledger_entries.amount_agorot` across every group you
-- are in. That was exactly right while every group kept its books in shekels.
-- Once `…_group_currency.sql` let a group be created in dollars, euros or
-- pounds, the same sum adds quantities that are not the same quantity, and the
-- number it produces is wrong in every currency at once.
--
-- There is no exchange rate anywhere in this app and there must not be one. A
-- rate would make a debt that two friends agreed on drift between the day it
-- was recorded and the day it is paid, which is precisely the argument the
-- ledger exists to prevent. So the totals are reported per currency and the
-- client prints however many rows there are — normally one.
--
-- ---------------------------------------------------------------------------
-- What this deliberately does NOT do
-- ---------------------------------------------------------------------------
-- `my_stats()` is untouched, and the profile still reads it. Its counts —
-- bets won, lost, settled, and the most active group — are counts of events,
-- not sums of money, so they are as meaningful across four currencies as they
-- were across one. Splitting them too would mean a win rate per currency,
-- which answers a question nobody asked.
--
-- Its two money columns stay as well, still summing everything together. They
-- are wrong in a mixed-currency account and the client no longer reads them;
-- removing them would be a breaking change to a function older clients call,
-- and CLAUDE.md §10 makes migrations append-only. The comment below says so on
-- the row where somebody would otherwise find out the hard way.

create or replace function public.my_totals_by_currency()
returns table (
  currency text,
  total_won_agorot bigint,
  total_lost_agorot bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(g.currency, 'ILS') as currency,
    coalesce(sum(e.amount_agorot) filter (where e.amount_agorot > 0), 0)::bigint,
    coalesce(-sum(e.amount_agorot) filter (where e.amount_agorot < 0), 0)::bigint
  from public.bet_ledger_entries e
  join public.bets b on b.id = e.bet_id
  join public.groups g on g.id = b.group_id
  where e.user_id = auth.uid()
  group by coalesce(g.currency, 'ILS')
  -- Largest first, so the currency somebody actually plays in leads. Ties
  -- broken by name so the order is stable rather than whatever the planner
  -- returns.
  order by
    sum(abs(e.amount_agorot)) desc,
    coalesce(g.currency, 'ILS');
$$;

comment on function public.my_totals_by_currency() is
  'Lifetime won/lost per currency. Use instead of my_stats''s two money '
  'columns, which sum across currencies and are only correct for an account '
  'whose groups all use the same one.';

-- CLAUDE.md §10: an explicit revoke in the same migration, because the
-- platform re-grants execute on newly created objects in `public`.
revoke execute on function public.my_totals_by_currency() from public, anon;
grant execute on function public.my_totals_by_currency() to authenticated;
