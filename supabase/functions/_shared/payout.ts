/**
 * Bet payout math.
 *
 * This is the one place in the codebase where a bug directly costs somebody
 * money, so it is deliberately kept as a dependency-free pure module: no
 * imports, no I/O, no Deno/React Native globals. It is the single source of
 * truth for both the Supabase Edge Function that writes ledger rows
 * (`supabase/functions/resolve-bet`) and the client-side "what would I win?"
 * preview (`src/lib/payout.ts` re-exports this file).
 *
 * Money is always integer agorot (1 ILS = 100 agorot). Never floats.
 */

export type BetSide = 'a' | 'b';

/** A participant in a bet, as stored in `bet_positions`. */
export interface BetParticipant {
  userId: string;
  side: BetSide;
}

/** One row destined for `bet_ledger_entries`. */
export interface LedgerEntry {
  userId: string;
  /** Signed: positive = owed to them, negative = they owe. */
  amountAgorot: number;
}

export interface PayoutResult {
  /** True when the pot actually moved. False when nobody backed the winner. */
  paidOut: boolean;
  /** Number of users on the winning side. */
  winnerCount: number;
  /** Number of users on the losing side. */
  loserCount: number;
  /** One entry per participant that has a non-zero result, ordered by userId. */
  entries: LedgerEntry[];
}

/**
 * Split `total` agorot across `userIds` as evenly as integers allow.
 *
 * Everyone gets `floor(total / n)`. The `total % n` leftover agorot are handed
 * out one at a time to the lexicographically smallest user ids, so the shares
 * always sum to exactly `total` and the same inputs always produce the same
 * output regardless of the order rows came back from Postgres.
 *
 * @returns shares ordered by ascending userId.
 */
export function splitEvenly(
  total: number,
  userIds: readonly string[]
): { userId: string; amountAgorot: number }[] {
  assertSafeAmount(total);
  if (total < 0) {
    throw new Error(`splitEvenly: total must be non-negative, got ${total}`);
  }
  const ordered = [...userIds].sort(compareUserIds);
  assertNoDuplicates(ordered);

  const n = ordered.length;
  if (n === 0) return [];

  const base = Math.floor(total / n);
  const remainder = total % n;

  return ordered.map((userId, index) => ({
    userId,
    amountAgorot: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * Resolve a bet into signed ledger entries.
 *
 * Rules (fixed product decisions, see the project spec):
 * - The creator sets one fixed `totalPotAgorot` for the whole bet. It does not
 *   scale with the number of participants.
 * - Winners share the pot: each gets `floor(pot / W)` plus at most one leftover
 *   agora, distributed deterministically by userId.
 * - Losers cover the pot: each owes `floor(pot / L)` plus at most one leftover
 *   agora, distributed the same way.
 * - Both sides therefore net to exactly `totalPotAgorot`.
 * - If nobody backed the winning side (W === 0), nothing is paid out at all —
 *   the bet still resolves, it just has no winners and no ledger entries.
 * - If nobody backed the losing side (L === 0) there is nothing to win, so the
 *   same "no money moves" rule applies.
 */
export function computeBetPayouts(
  totalPotAgorot: number,
  participants: readonly BetParticipant[],
  winningSide: BetSide
): PayoutResult {
  if (!Number.isSafeInteger(totalPotAgorot) || totalPotAgorot <= 0) {
    throw new Error(
      `computeBetPayouts: totalPotAgorot must be a positive integer, got ${totalPotAgorot}`
    );
  }
  if (winningSide !== 'a' && winningSide !== 'b') {
    throw new Error(`computeBetPayouts: winningSide must be 'a' or 'b'`);
  }

  const seen = new Set<string>();
  for (const p of participants) {
    if (p.side !== 'a' && p.side !== 'b') {
      throw new Error(`computeBetPayouts: participant side must be 'a' or 'b'`);
    }
    if (seen.has(p.userId)) {
      throw new Error(
        `computeBetPayouts: user ${p.userId} appears on more than one side`
      );
    }
    seen.add(p.userId);
  }

  const winners = participants
    .filter((p) => p.side === winningSide)
    .map((p) => p.userId);
  const losers = participants
    .filter((p) => p.side !== winningSide)
    .map((p) => p.userId);

  // Nobody to pay, or nobody to pay them: the bet resolves with no movement.
  if (winners.length === 0 || losers.length === 0) {
    return {
      paidOut: false,
      winnerCount: winners.length,
      loserCount: losers.length,
      entries: [],
    };
  }

  const credits = splitEvenly(totalPotAgorot, winners);
  const debits = splitEvenly(totalPotAgorot, losers);

  const entries: LedgerEntry[] = [
    ...credits.map((c) => ({ userId: c.userId, amountAgorot: c.amountAgorot })),
    ...debits.map((d) => ({ userId: d.userId, amountAgorot: -d.amountAgorot })),
  ]
    .filter((e) => e.amountAgorot !== 0)
    .sort((x, y) => compareUserIds(x.userId, y.userId));

  return {
    paidOut: true,
    winnerCount: winners.length,
    loserCount: losers.length,
    entries,
  };
}

/**
 * What a single extra participant would win or owe, used for the live
 * "join side A" preview before the bet is resolved. Returns the per-person
 * base share (leftover agorot are ignored — they are a rounding detail worth
 * at most one agora and would make the preview jump around).
 */
export function previewShareAgorot(
  totalPotAgorot: number,
  peopleOnSide: number
): number {
  if (peopleOnSide <= 0) return 0;
  return Math.floor(totalPotAgorot / peopleOnSide);
}

/** Byte-order comparison so ordering never depends on the host locale. */
function compareUserIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function assertNoDuplicates(sortedIds: readonly string[]): void {
  for (let i = 1; i < sortedIds.length; i++) {
    if (sortedIds[i] === sortedIds[i - 1]) {
      throw new Error(`splitEvenly: duplicate userId ${sortedIds[i]}`);
    }
  }
}

function assertSafeAmount(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Amount must be a safe integer, got ${value}`);
  }
}
