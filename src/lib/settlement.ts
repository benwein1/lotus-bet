/**
 * Group settlement — "smart Splitwise".
 *
 * Net every member's ledger lines into a single balance, then greedily match
 * the biggest debtor against the biggest creditor to get a short list of
 * "X pays Y" transactions. Nothing here is persisted: it is recomputed every
 * time the settle-up screen opens. Only an explicit "mark as paid" writes a
 * row (see `settlement_confirmations`), and that row feeds back in as a
 * balance adjustment via `netBalances`.
 */

export interface BalanceLine {
  userId: string;
  /** Signed agorot: positive = the group owes them, negative = they owe. */
  amountAgorot: number;
}

export interface SettlementTransaction {
  fromUserId: string;
  toUserId: string;
  amountAgorot: number;
}

/** A recorded "I paid you" confirmation. */
export interface SettlementPayment {
  fromUserId: string;
  toUserId: string;
  amountAgorot: number;
}

/**
 * Fold raw ledger rows and recorded payments into one balance per user.
 *
 * A payment of X from A to B cancels X of A's debt, so it moves A up by X and
 * B down by X. That is what keeps a settled-up transaction from reappearing on
 * the next render.
 *
 * Users are returned sorted by userId; zero balances are kept so callers can
 * show "all square" rows if they want to.
 */
export function netBalances(
  ledger: readonly BalanceLine[],
  payments: readonly SettlementPayment[] = []
): BalanceLine[] {
  const totals = new Map<string, number>();
  const add = (userId: string, amount: number) => {
    totals.set(userId, (totals.get(userId) ?? 0) + amount);
  };

  for (const line of ledger) add(line.userId, line.amountAgorot);
  for (const payment of payments) {
    add(payment.fromUserId, payment.amountAgorot);
    add(payment.toUserId, -payment.amountAgorot);
  }

  return [...totals.entries()]
    .map(([userId, amountAgorot]) => ({ userId, amountAgorot }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Greedy debt simplification: repeatedly settle the largest debt against the
 * largest credit. Produces at most `n - 1` transactions for `n` non-zero
 * balances, which is the practical minimum for this kind of netting.
 *
 * Input balances are not mutated. Balances are expected to sum to zero (they
 * do by construction, since every bet writes matching credits and debits); any
 * residual is simply left unsettled rather than silently invented.
 */
export function simplifyDebts(
  balances: readonly BalanceLine[]
): SettlementTransaction[] {
  const creditors = balances
    .filter((b) => b.amountAgorot > 0)
    .map((b) => ({ ...b }))
    // Largest credit first, userId as a deterministic tiebreak.
    .sort((a, b) => b.amountAgorot - a.amountAgorot || cmp(a.userId, b.userId));
  const debtors = balances
    .filter((b) => b.amountAgorot < 0)
    .map((b) => ({ ...b }))
    // Largest debt (most negative) first.
    .sort((a, b) => a.amountAgorot - b.amountAgorot || cmp(a.userId, b.userId));

  const transactions: SettlementTransaction[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const amountAgorot = Math.min(-debtor.amountAgorot, creditor.amountAgorot);

    if (amountAgorot > 0) {
      transactions.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountAgorot,
      });
    }

    debtor.amountAgorot += amountAgorot;
    creditor.amountAgorot -= amountAgorot;

    if (debtor.amountAgorot === 0) i++;
    if (creditor.amountAgorot === 0) j++;
  }

  return transactions;
}

/**
 * Stable identity for a suggested transaction, so a "mark as paid" toggle can
 * be matched back to the row it settled.
 */
export function transactionKey(txn: SettlementTransaction): string {
  return `${txn.fromUserId}:${txn.toUserId}:${txn.amountAgorot}`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
