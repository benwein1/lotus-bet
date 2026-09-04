/**
 * Every Supabase read/write the app makes, in one place.
 *
 * Screens call these; they never build queries inline. Keeping them together
 * makes the RLS surface easy to audit — if a table is not touched here, the
 * client never reads it.
 */
import type {
  BetLedgerEntryRow,
  BetRow,
  BetSide,
  BetWithPositions,
  GroupBalanceRow,
  GroupMemberRow,
  GroupRow,
  MyStatsRow,
  SettlementConfirmationRow,
  UserRow,
} from './database.types';
import { supabase } from './supabase';

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('No data returned');
  return result.data;
}

// --- Groups ----------------------------------------------------------------

export interface GroupWithMembers extends GroupRow {
  members: (GroupMemberRow & { user: UserRow })[];
}

export async function fetchMyGroups(): Promise<GroupWithMembers[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('*, members:group_members(*, user:users(*))')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as GroupWithMembers[];
}

export async function fetchGroup(groupId: string): Promise<GroupWithMembers> {
  return unwrap(
    await supabase
      .from('groups')
      .select('*, members:group_members(*, user:users(*))')
      .eq('id', groupId)
      .single()
  ) as unknown as GroupWithMembers;
}

export async function createGroup(name: string, emoji: string | null): Promise<GroupRow> {
  return unwrap(
    await supabase.rpc('create_group', { p_name: name, p_emoji: emoji }).single()
  ) as GroupRow;
}

export async function joinGroupWithCode(code: string): Promise<GroupRow> {
  return unwrap(
    await supabase.rpc('join_group_with_code', { p_code: code }).single()
  ) as GroupRow;
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
}

// --- Bets ------------------------------------------------------------------

const BET_SELECT = '*, positions:bet_positions(user_id, side)';
const BET_SELECT_WITH_GROUP = `${BET_SELECT}, group:groups(id, name, emoji)`;

export async function fetchGroupBets(groupId: string): Promise<BetWithPositions[]> {
  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BetWithPositions[];
}

/** Every bet across every group the user is in — the Home feed's raw input. */
export async function fetchFeedBets(): Promise<BetWithPositions[]> {
  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT_WITH_GROUP)
    .in('status', ['open', 'locked'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BetWithPositions[];
}

export async function fetchBet(betId: string): Promise<BetWithPositions> {
  return unwrap(
    await supabase.from('bets').select(BET_SELECT_WITH_GROUP).eq('id', betId).single()
  ) as unknown as BetWithPositions;
}

export interface NewBetInput {
  groupId: string;
  creatorId: string;
  title: string;
  description: string | null;
  optionALabel: string;
  optionBLabel: string;
  totalPotAgorot: number;
  closeAt: string | null;
}

export async function createBet(input: NewBetInput): Promise<BetRow> {
  return unwrap(
    await supabase
      .from('bets')
      .insert({
        group_id: input.groupId,
        creator_id: input.creatorId,
        title: input.title,
        description: input.description,
        option_a_label: input.optionALabel,
        option_b_label: input.optionBLabel,
        total_pot_agorot: input.totalPotAgorot,
        close_at: input.closeAt,
      })
      .select()
      .single()
  ) as BetRow;
}

export async function joinBet(betId: string, side: BetSide): Promise<void> {
  const { error } = await supabase.rpc('join_bet', { p_bet_id: betId, p_side: side });
  if (error) throw new Error(error.message);
}

export async function leaveBet(betId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_bet', { p_bet_id: betId });
  if (error) throw new Error(error.message);
}

export async function lockBet(betId: string): Promise<void> {
  const { error } = await supabase.rpc('lock_bet', { p_bet_id: betId });
  if (error) throw new Error(error.message);
}

export async function cancelBet(betId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_bet', { p_bet_id: betId });
  if (error) throw new Error(error.message);
}

export interface ResolveBetResult {
  paidOut: boolean;
  winnerCount: number;
  loserCount: number;
}

/**
 * Resolution goes through an Edge Function, not a direct write: the ledger is
 * service-role only, so the payout maths runs once, server-side, atomically.
 */
export async function resolveBet(
  betId: string,
  winningOption: BetSide
): Promise<ResolveBetResult> {
  const { data, error } = await supabase.functions.invoke<
    ResolveBetResult & { error?: string }
  >('resolve-bet', { body: { betId, winningOption } });

  if (error) throw new Error(error.message);
  if (!data) throw new Error('The server did not confirm the resolution.');
  if (data.error) throw new Error(data.error);

  return data;
}

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

// --- Profile ---------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  amount_agorot: number;
  created_at: string;
  bet: Pick<BetRow, 'id' | 'title' | 'winning_option' | 'option_a_label' | 'option_b_label' | 'resolved_at'>;
  group: Pick<GroupRow, 'id' | 'name' | 'emoji'>;
}

export async function fetchMyHistory(userId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from('bet_ledger_entries')
    .select(
      'id, amount_agorot, created_at, bet:bets(id, title, winning_option, option_a_label, option_b_label, resolved_at), group:groups(id, name, emoji)'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HistoryEntry[];
}

export async function fetchMyStats(): Promise<MyStatsRow | null> {
  const { data, error } = await supabase.rpc('my_stats');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MyStatsRow[];
  return rows[0] ?? null;
}

/** The signed results the resolve-bet function wrote for one bet. */
export async function fetchBetLedger(betId: string): Promise<BetLedgerEntryRow[]> {
  const { data, error } = await supabase
    .from('bet_ledger_entries')
    .select('*')
    .eq('bet_id', betId);

  if (error) throw new Error(error.message);
  return (data ?? []) as BetLedgerEntryRow[];
}
