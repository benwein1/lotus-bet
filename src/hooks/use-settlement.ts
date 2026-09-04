import { useMemo } from 'react';

import type { GroupBalanceRow, SettlementConfirmationRow, UserRow } from '@/lib/database.types';
import {
  netBalances,
  simplifyDebts,
  type BalanceLine,
  type SettlementTransaction,
} from '@/lib/settlement';

export interface SettlementView {
  /** Every member's net position, biggest creditor first. */
  balances: (BalanceLine & { user: UserRow | undefined })[];
  /** The minimal set of payments that squares the group up. */
  transactions: (SettlementTransaction & {
    fromUser: UserRow | undefined;
    toUser: UserRow | undefined;
  })[];
  myBalanceAgorot: number;
}

/**
 * Turns raw balances and confirmed payments into the settle-up screen's model.
 *
 * `group_balances()` already folds in confirmed payments server-side; the
 * `confirmations` argument is applied again here only for rows that arrived
 * optimistically from a "mark as paid" tap before the refetch landed.
 */
export function useSettlement(
  balanceRows: GroupBalanceRow[] | null,
  members: { user: UserRow }[] | null,
  pendingConfirmations: SettlementConfirmationRow[],
  currentUserId: string
): SettlementView {
  return useMemo(() => {
    const usersById = new Map((members ?? []).map((m) => [m.user.id, m.user]));

    const lines: BalanceLine[] = (balanceRows ?? []).map((row) => ({
      userId: row.user_id,
      amountAgorot: Number(row.amount_agorot),
    }));

    const balances = netBalances(
      lines,
      pendingConfirmations.map((c) => ({
        fromUserId: c.from_user_id,
        toUserId: c.to_user_id,
        amountAgorot: c.amount_agorot,
      }))
    );

    const transactions = simplifyDebts(balances).map((txn) => ({
      ...txn,
      fromUser: usersById.get(txn.fromUserId),
      toUser: usersById.get(txn.toUserId),
    }));

    return {
      balances: balances
        .map((b) => ({ ...b, user: usersById.get(b.userId) }))
        .sort((a, b) => b.amountAgorot - a.amountAgorot),
      transactions,
      myBalanceAgorot:
        balances.find((b) => b.userId === currentUserId)?.amountAgorot ?? 0,
    };
  }, [balanceRows, members, pendingConfirmations, currentUserId]);
}
