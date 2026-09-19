/**
 * The order the Home feed is read in.
 *
 * Two bands, newest first inside each:
 *
 *   1. **Live** — still open and still inside its deadline. The bets you can
 *      actually do something about.
 *   2. **Closed but not called** — locked by the creator, or open and past
 *      `close_at`. Nothing more can be staked; they are waiting on a result.
 *
 * ---------------------------------------------------------------------------
 * Why this is not an `order by` on the query
 * ---------------------------------------------------------------------------
 * "Live" is not a column. A bet is live when `status = 'open'` **and** its
 * deadline has not passed, and the second half is a comparison against *now* —
 * so the same row is live at 14:59 and not at 15:01 with nothing written to
 * it. PostgREST cannot express that, and adding a materialised `is_live`
 * column would mean a job to flip it and a window where the feed lies.
 *
 * Sorting client-side over the hundred rows the feed already fetches costs
 * nothing measurable and is always right at the moment it renders.
 *
 * `resolved` and `cancelled` never reach here — `fetchFeedBets` asks only for
 * `open` and `locked`. They are handled anyway, at the bottom, so that adding
 * a status to the query cannot silently scatter unknown rows through the feed.
 */

/** The fields the ordering reads. Anything with these can be sorted. */
export interface OrderableBet {
  status: string;
  close_at: string | null;
  created_at: string;
}

/**
 * Which band a bet belongs to. Lower sorts first.
 *
 * Exported because the feed renders a divider between bands, and computing
 * "did the band change" from the same function that ordered them is what stops
 * the two disagreeing.
 */
export function feedBand(bet: OrderableBet, now: number = Date.now()): number {
  if (bet.status === 'open') {
    const deadline = bet.close_at ? new Date(bet.close_at).getTime() : null;
    // A malformed date is treated as no deadline rather than as expired: the
    // creator set a bet running, and a parse failure should not quietly retire
    // it from the live band.
    const expired = deadline !== null && !Number.isNaN(deadline) && deadline <= now;
    return expired ? 1 : 0;
  }
  if (bet.status === 'locked') return 1;
  // Resolved, cancelled, or anything added later. Never silently interleaved.
  return 2;
}

/**
 * Sorted copy: live newest-first, then closed-but-uncalled newest-first.
 *
 * Returns a new array — the feed holds the fetched list in state and mutating
 * it in place would make React's identity check miss the change.
 */
export function orderFeed<T extends OrderableBet>(bets: readonly T[], now: number = Date.now()): T[] {
  return [...bets].sort((a, b) => {
    const band = feedBand(a, now) - feedBand(b, now);
    if (band !== 0) return band;

    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    // Unparseable timestamps sink rather than shuffling: NaN comparisons are
    // all false, which makes a sort order non-deterministic.
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;

    return bt - at;
  });
}
