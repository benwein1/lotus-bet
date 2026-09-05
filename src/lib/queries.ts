/**
 * Every Supabase read/write the app makes, in one place.
 *
 * Screens call these; they never build queries inline. Keeping them together
 * makes the RLS surface easy to audit — if a table is not touched here, the
 * client never reads it.
 */
import type {
  BetLedgerEntryRow,
  BetMediaRow,
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
import { demo, isDemoMode } from './demo';
import { signMedia, uploadBetMedia, type PickedMedia } from './media';
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
  if (isDemoMode()) return demo.fetchMyGroups();
  const { data, error } = await supabase
    .from('groups')
    .select('*, members:group_members(*, user:users(*))')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as GroupWithMembers[];
}

export async function fetchGroup(groupId: string): Promise<GroupWithMembers> {
  if (isDemoMode()) return demo.fetchGroup(groupId);
  return unwrap(
    await supabase
      .from('groups')
      .select('*, members:group_members(*, user:users(*))')
      .eq('id', groupId)
      .single()
  ) as unknown as GroupWithMembers;
}

export async function createGroup(name: string, emoji: string | null): Promise<GroupRow> {
  if (isDemoMode()) return demo.createGroup(name, emoji);
  return unwrap(
    await supabase.rpc('create_group', { p_name: name, p_emoji: emoji }).single()
  ) as GroupRow;
}

export async function joinGroupWithCode(code: string): Promise<GroupRow> {
  if (isDemoMode()) return demo.joinGroupWithCode(code);
  return unwrap(
    await supabase.rpc('join_group_with_code', { p_code: code }).single()
  ) as GroupRow;
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  if (isDemoMode()) return demo.leaveGroup(groupId, userId);
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
}

// --- Bets ------------------------------------------------------------------

const BET_SELECT = '*, positions:bet_positions(user_id, side), media:bet_media(*)';
const BET_SELECT_WITH_GROUP = `${BET_SELECT}, group:groups(id, name, emoji)`;

/**
 * Media rows arrive as storage paths; the bucket is private, so they have to be
 * signed before anything can render them. Signing is batched across the whole
 * result — a feed of ten bets with photos costs one round trip, not ten.
 */
async function attachSignedMedia<T extends { media?: BetMediaRow[] | null }>(
  bets: T[]
): Promise<T[]> {
  const rows = bets.flatMap((bet) => bet.media ?? []);
  if (rows.length === 0) return bets.map((bet) => ({ ...bet, media: [] }));

  const signed = await signMedia(rows);
  const byId = new Map(signed.map((row) => [row.id, row]));

  return bets.map((bet) => ({
    ...bet,
    media: (bet.media ?? [])
      .map((row) => byId.get(row.id))
      .filter((row) => row !== undefined)
      .sort((a, b) => a.position - b.position),
  }));
}

export async function fetchGroupBets(groupId: string): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchGroupBets(groupId);
  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

/** Every bet across every group the user is in — the Home feed's raw input. */
export async function fetchFeedBets(): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchFeedBets();
  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT_WITH_GROUP)
    .in('status', ['open', 'locked'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

export async function fetchBet(betId: string): Promise<BetWithPositions> {
  if (isDemoMode()) return demo.fetchBet(betId);
  const bet = unwrap(
    await supabase.from('bets').select(BET_SELECT_WITH_GROUP).eq('id', betId).single()
  ) as unknown as BetWithPositions;

  const [withMedia] = await attachSignedMedia([bet]);
  return withMedia ?? bet;
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
  /** Photos and videos picked on the new-bet screen, uploaded after insert. */
  media?: PickedMedia[];
}

export async function createBet(input: NewBetInput): Promise<BetRow> {
  if (isDemoMode()) return demo.createBet(input);

  const bet = unwrap(
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

  // Media is uploaded after the bet exists: its id is part of the storage
  // path, which is what lets the bucket policy check group membership. A
  // failure here leaves the bet posted without its attachments rather than
  // losing the bet, which is the better of the two failures.
  if (input.media?.length) {
    await attachMediaToBet(bet, input.media, input.creatorId);
  }

  return bet;
}

async function attachMediaToBet(
  bet: BetRow,
  media: PickedMedia[],
  uploaderId: string
): Promise<void> {
  const uploaded = [] as {
    bet_id: string;
    group_id: string;
    uploaded_by: string;
    kind: string;
    storage_path: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    position: number;
  }[];

  for (const [index, item] of media.entries()) {
    const result = await uploadBetMedia(bet.group_id, bet.id, item);
    uploaded.push({
      bet_id: bet.id,
      group_id: bet.group_id,
      uploaded_by: uploaderId,
      kind: result.kind,
      storage_path: result.storagePath,
      width: result.width,
      height: result.height,
      duration_ms: result.durationMs,
      position: index,
    });
  }

  const { error } = await supabase.from('bet_media').insert(uploaded);
  if (error) throw new Error(error.message);
}

export async function joinBet(betId: string, side: BetSide): Promise<void> {
  if (isDemoMode()) return demo.joinBet(betId, side);
  const { error } = await supabase.rpc('join_bet', { p_bet_id: betId, p_side: side });
  if (error) throw new Error(error.message);
}

export async function leaveBet(betId: string): Promise<void> {
  if (isDemoMode()) return demo.leaveBet(betId);
  const { error } = await supabase.rpc('leave_bet', { p_bet_id: betId });
  if (error) throw new Error(error.message);
}

export async function lockBet(betId: string): Promise<void> {
  if (isDemoMode()) return demo.lockBet(betId);
  const { error } = await supabase.rpc('lock_bet', { p_bet_id: betId });
  if (error) throw new Error(error.message);
}

export async function cancelBet(betId: string): Promise<void> {
  if (isDemoMode()) return demo.cancelBet(betId);
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
  if (isDemoMode()) return demo.resolveBet(betId, winningOption);

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
  if (isDemoMode()) return demo.fetchGroupBalances(groupId);
  const { data, error } = await supabase.rpc('group_balances', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return (data ?? []) as GroupBalanceRow[];
}

export async function fetchSettlementConfirmations(
  groupId: string
): Promise<SettlementConfirmationRow[]> {
  if (isDemoMode()) return demo.fetchSettlementConfirmations(groupId);
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
  if (isDemoMode()) return demo.confirmSettlement(input);

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
  if (isDemoMode()) return demo.undoSettlement(confirmationId);
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
  if (isDemoMode()) return demo.fetchMyHistory(userId);
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
  if (isDemoMode()) return demo.fetchMyStats();
  const { data, error } = await supabase.rpc('my_stats');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MyStatsRow[];
  return rows[0] ?? null;
}

/** The signed results the resolve-bet function wrote for one bet. */
export async function fetchBetLedger(betId: string): Promise<BetLedgerEntryRow[]> {
  if (isDemoMode()) return demo.fetchBetLedger(betId);
  const { data, error } = await supabase
    .from('bet_ledger_entries')
    .select('*')
    .eq('bet_id', betId);

  if (error) throw new Error(error.message);
  return (data ?? []) as BetLedgerEntryRow[];
}
