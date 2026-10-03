/**
 * The cumulative line on Profile, built from the ledger you already have.
 *
 * There is no time series anywhere in this schema and there does not need to
 * be one: `bet_ledger_entries` carries a signed amount and a timestamp per
 * settled bet, which is a running total waiting to be added up. Deriving it on
 * the client means the chart cannot drift from the figures printed beside it,
 * because they are the same rows.
 *
 * **One currency at a time, always.** Betta has no exchange rate and must not
 * grow one — a rate would make a debt two friends agreed on drift between the
 * day it was recorded and the day it is paid. So the series is built for a
 * single currency and the caller says which; entries in any other are left
 * out rather than converted or quietly added.
 */

export type LedgerPoint = {
  amountAgorot: number;
  at: string;
  currency?: string | null;
};

export type ChartSeries = {
  /** Running total after each settled bet, oldest first, in minor units. */
  points: number[];
  /**
   * When each point happened, same order and same length as `points`.
   *
   * Parallel to `points` rather than folded into it because `normalise` and
   * every test around it work on plain numbers, and the axis is the only
   * thing that ever needs a date.
   */
  dates: string[];
  /** Where the line ends — the same number the heading prints. */
  net: number;
  /** How much of `net` landed in the last 30 days. */
  recent: number;
  /** The currency every point is in. */
  currency: string;
  /** How many settled bets the line is drawn from. */
  count: number;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Which currency the chart should be in when an account has more than one.
 *
 * The one with the most settled bets, not the largest total: a single big bet
 * in a currency you rarely use should not decide what the line is about.
 * Ties go to whichever currency the most recent entry is in, so a chart never
 * flips between two equally busy currencies on a refresh.
 */
export function dominantCurrency(entries: LedgerPoint[], fallback = 'USD'): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.currency ?? fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;

  let best = fallback;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export function buildSeries(
  entries: LedgerPoint[],
  currency: string,
  now: number = Date.now()
): ChartSeries {
  const mine = entries
    .filter((entry) => (entry.currency ?? currency) === currency)
    .slice()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const points: number[] = [];
  const dates: string[] = [];
  let running = 0;
  let recent = 0;
  const cutoff = now - 30 * DAY;

  for (const entry of mine) {
    running += entry.amountAgorot;
    points.push(running);
    dates.push(entry.at);
    if (Date.parse(entry.at) >= cutoff) recent += entry.amountAgorot;
  }

  return { points, dates, net: running, recent, currency, count: mine.length };
}

/**
 * The points as x/y in a 0..1 box, ready to be scaled to any size.
 *
 * Zero is always on the scale even when every point is above or below it, so
 * a line that never lost still reads as a climb from nothing rather than as a
 * flat wobble across the middle. A single point becomes a flat line across the
 * box: one settled bet is a fact, not a trend, and drawing it as a spike from
 * the floor would overstate it.
 */
export function normalise(points: number[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }];

  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;

  return points.map((value, index) => ({
    x: index / (points.length - 1),
    // y grows downward on screen, so a bigger total is a smaller y.
    y: 1 - (value - min) / span,
  }));
}
