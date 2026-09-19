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
import { asCurrency, type Currency } from './currency';


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

/** One group's netted balances, ready to be folded into a per-person total. */
export interface GroupLedger {
  groupId: string;
  groupName: string;
  balances: readonly BalanceLine[];
  /**
   * What this group's integers denominate. Absent reads as the default — a
   * group row fetched before `…_group_currency.sql` has no column to read.
   */
  currency?: string | null;
}

/**
 * What one counterparty owes you, or you them, across every group you share
 * **that keeps its books in one currency**.
 *
 * One person can appear more than once — once per currency you have a running
 * total with them in. That is not a rough edge to smooth over: dollars and
 * shekels are different quantities, and adding them would produce a number
 * that is wrong in both. There is no exchange rate anywhere in this app and
 * there must not be one, because a rate would make a recorded debt drift
 * between the day it was agreed and the day it is paid.
 */
export interface PersonTotal {
  userId: string;
  /** Positive: they owe you. Negative: you owe them. */
  amountAgorot: number;
  /** The currency `amountAgorot` is in minor units of. */
  currency: Currency;
  /** Every group that contributed, in the order they were passed. */
  groupNames: string[];
}

/**
 * Roll every group's suggested settlements up into one figure per person.
 *
 * Debts only net *within* a group — the ledger has no notion of a debt between
 * two people, only a balance per person per group — so this runs the same
 * `simplifyDebts` the settle-up screen runs, per group, and then sums the
 * transactions that involve you. Two consequences worth knowing:
 *
 * - Owing Dana in one group and being owed by her in another cancels out, and
 *   the row names both groups. That matches what people mean by "what do we
 *   owe each other".
 * - The figure is a *suggestion*, the same one settle-up shows, not a stored
 *   debt. It can change when someone else settles, because the greedy matching
 *   re-runs. That is a property of the netting, not of this function.
 *
 * People who come out at zero are dropped. Sorted with the largest amount owed
 * to you first, then the largest you owe, so the good news reads first and the
 * order is deterministic.
 */
export function personBalances(
  ledgers: readonly GroupLedger[],
  myUserId: string
): PersonTotal[] {
  const totals = new Map<
    string,
    { userId: string; currency: Currency; amount: number; groups: string[] }
  >();

  for (const ledger of ledgers) {
    const currency = asCurrency(ledger.currency);
    for (const txn of simplifyDebts(ledger.balances)) {
      // Only transactions with me on one side say anything about what I owe.
      const iPay = txn.fromUserId === myUserId;
      const iAmPaid = txn.toUserId === myUserId;
      if (!iPay && !iAmPaid) continue;

      const other = iPay ? txn.toUserId : txn.fromUserId;
      const signed = iAmPaid ? txn.amountAgorot : -txn.amountAgorot;

      // Keyed on the pair, not on the person: owing Dana $30 and being owed
      // ₪30 by her are two separate running totals, and cancelling them
      // against each other would invent an exchange rate.
      const key = `${other}\u0000${currency}`;
      const entry = totals.get(key) ?? { userId: other, currency, amount: 0, groups: [] };
      entry.amount += signed;
      if (!entry.groups.includes(ledger.groupName)) entry.groups.push(ledger.groupName);
      totals.set(key, entry);
    }
  }

  return [...totals.values()]
    .filter((entry) => entry.amount !== 0)
    .map((entry) => ({
      userId: entry.userId,
      amountAgorot: entry.amount,
      currency: entry.currency,
      groupNames: entry.groups,
    }))
    .sort(
      (a, b) =>
        b.amountAgorot - a.amountAgorot ||
        cmp(a.userId, b.userId) ||
        cmp(a.currency, b.currency)
    );
}
