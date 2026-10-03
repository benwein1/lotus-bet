/**
 * What, out of everything on screen, is actually waiting for *you*.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The loop this app runs on is: somebody posts a bet, friends take sides, the
 * creator calls it, the ledger moves, people settle up. Every one of those
 * steps is a human doing something, and until now nothing in the product said
 * which step was waiting on the person holding the phone.
 *
 * Two consequences, both of them expensive:
 *
 * - **A bet nobody answers is a bet that never happened.** It sits in the feed
 *   looking exactly like the fifteen bets already decided, scrolls past, and
 *   the deadline quietly takes it.
 * - **A bet nobody calls never becomes money owed.** Only the creator can call
 *   one, and nothing has ever reminded them. That is where the loop actually
 *   breaks: the ledger stops moving, so settle-up has nothing in it, so the
 *   group stops opening the app.
 *
 * So this is one derived idea — *is this bet waiting on me, and for what* —
 * computed from rows the feed already has, and read by the ordering, the
 * cards, the group screen and the tab bar. One definition, four surfaces. The
 * alternative is four slightly different opinions about what "needs you"
 * means, which is how a badge ends up counting something the list does not
 * show.
 *
 * Pure and dependency-free on purpose: no Supabase, no React, no clock of its
 * own. `now` is a parameter because "past its deadline" is a comparison
 * against a moment, and a function that reads the clock itself cannot be
 * tested at the interesting boundary.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does *not* claim
 * ---------------------------------------------------------------------------
 * Money you owe is not in here. It is real, and it is the third thing that
 * needs a human — but it is a property of a *balance*, not of a bet, it is
 * netted per person per currency (see `settlement.ts`), and it already has a
 * home on Profile and in settle-up. Folding it into a per-bet signal would
 * mean counting one debt once per bet that produced it.
 */

import { feedBand, type OrderableBet } from './feed-order';

/**
 * Why a bet is waiting on the viewer, or `null` when it is not.
 *
 * - `answer` — it is live, and you have not picked a side. The window is open
 *   and it closes on its own.
 * - `call`   — you created it, nothing more can be staked, and it has no
 *   result. Nobody else can do this one.
 */
export type AttentionKind = 'answer' | 'call';

/** The fields the rule reads. Anything carrying these can be asked. */
export interface AttentionBet extends OrderableBet {
  creator_id: string;
  positions?: readonly { user_id: string }[] | null;
}

/**
 * Whether this bet is waiting on this person, and for what.
 *
 * Order matters: `answer` is checked first because a live bet you have not
 * answered is still answerable *by you even if you created it* — a creator
 * takes a side like anyone else — and answering is the time-boxed one. `call`
 * only becomes true once the window has shut, so the two can never both apply.
 */
export function attentionFor(
  bet: AttentionBet,
  userId: string,
  now: number = Date.now()
): AttentionKind | null {
  if (!userId) return null;

  const band = feedBand(bet, now);

  // Band 0 is live: open, and inside its deadline if it has one.
  if (band === 0) {
    const mine = (bet.positions ?? []).some((position) => position.user_id === userId);
    return mine ? null : 'answer';
  }

  // Band 1 is closed but uncalled — locked by hand, or open and past its
  // deadline. Only the creator can resolve, so it is only ever their turn.
  if (band === 1 && bet.creator_id === userId) return 'call';

  return null;
}

/** How many bets are waiting on this person, split by what they want. */
export interface AttentionCount {
  answer: number;
  call: number;
  total: number;
}

export function countAttention(
  bets: readonly AttentionBet[],
  userId: string,
  now: number = Date.now()
): AttentionCount {
  let answer = 0;
  let call = 0;

  for (const bet of bets) {
    const kind = attentionFor(bet, userId, now);
    if (kind === 'answer') answer += 1;
    else if (kind === 'call') call += 1;
  }

  return { answer, call, total: answer + call };
}

/**
 * The sentence a count becomes, or null when there is nothing to say.
 *
 * Written out rather than templated from a count because "1 bet needs your
 * side" and "2 bets need your side" differ in more than a digit, and because
 * the both-kinds case reads better as one clause than as two joined by a
 * comma. It is the only place this phrasing exists, so the tab bar, the feed
 * and the group screen cannot drift into three wordings of one fact.
 */
export function describeAttention(count: AttentionCount): string | null {
  const { answer, call } = count;
  if (answer === 0 && call === 0) return null;

  const sides = answer === 1 ? '1 bet needs your side' : `${answer} bets need your side`;
  const calls = call === 1 ? '1 is yours to call' : `${call} are yours to call`;

  if (answer === 0) return call === 1 ? '1 bet is yours to call' : `${call} bets are yours to call`;
  if (call === 0) return sides;
  return `${sides}, and ${calls}`;
}

/**
 * The feed's order, for one viewer.
 *
 * Three keys, in this order:
 *
 *   1. **Waiting on you**, and within that, answering before calling. A
 *      deadline runs out on its own; a bet you have to call will wait.
 *   2. **The bet's own lifecycle** — `feedBand`, unchanged: live above
 *      closed-but-uncalled above everything else.
 *   3. **Newest first.**
 *
 * ---------------------------------------------------------------------------
 * What this replaces, and why it was wrong
 * ---------------------------------------------------------------------------
 * The feed screen used to re-partition the list into "bets I have a position
 * in" and then everything else, *after* the query had already ordered it by
 * `feedBand`. Two sorts with different opinions, the second one winning — so a
 * locked bet you had already answered (nothing left to do) outranked a live
 * one you had not (the only thing on the screen that needed you). The most
 * actionable card in the app sank to the bottom of the list.
 *
 * Composed rather than copied: the lifecycle half is still `feedBand`'s, so
 * there is exactly one definition of "live" and this file cannot drift from
 * it.
 */
export function orderForViewer<T extends AttentionBet>(
  bets: readonly T[],
  userId: string,
  now: number = Date.now()
): T[] {
  const rank = (bet: T): number => {
    const kind = attentionFor(bet, userId, now);
    if (kind === 'answer') return 0;
    if (kind === 'call') return 1;
    return 2;
  };

  return [...bets].sort((a, b) => {
    const byAttention = rank(a) - rank(b);
    if (byAttention !== 0) return byAttention;

    const byBand = feedBand(a, now) - feedBand(b, now);
    if (byBand !== 0) return byBand;

    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    // Unparseable timestamps sink rather than shuffling: every comparison
    // against NaN is false, which makes the sort order non-deterministic.
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at;
  });
}
