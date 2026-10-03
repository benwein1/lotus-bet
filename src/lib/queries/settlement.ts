/**
 * Balances, and the payments people tick off against them.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  GroupBalanceRow,
  SettlementConfirmationRow,
} from '../database.types';
import { supabase } from '../supabase';

// --- Settlement ------------------------------------------------------------

export async function fetchGroupBalances(groupId: string): Promise<GroupBalanceRow[]> {
  const { data, error } = await supabase.rpc('group_balances', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return (data ?? []) as GroupBalanceRow[];
}

export async function fetchSettlementConfirmations(
  groupId: string
): Promise<SettlementConfirmationRow[]> {
  const { data, error } = await supabase
    .from('settlement_confirmations')
    .select('*')
    .eq('group_id', groupId);

  if (error) throw new Error(error.message);
  return (data ?? []) as SettlementConfirmationRow[];
}

export async function confirmSettlement(input: {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountAgorot: number;
  confirmedBy: string;
}): Promise<void> {

  const { error } = await supabase.from('settlement_confirmations').insert({
    group_id: input.groupId,
    from_user_id: input.fromUserId,
    to_user_id: input.toUserId,
    amount_agorot: input.amountAgorot,
    confirmed_by: input.confirmedBy,
  });

  if (error) throw new Error(error.message);
}

export async function undoSettlement(confirmationId: string): Promise<void> {
  const { error } = await supabase
    .from('settlement_confirmations')
    .delete()
    .eq('id', confirmationId);

  if (error) throw new Error(error.message);
}

