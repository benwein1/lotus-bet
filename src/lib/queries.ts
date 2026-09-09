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
import { announceBetResolved, announceGroupJoin, announceNewBet } from './notifications';
import { computeBetPayouts } from './payout';
import { isMissingColumn } from './postgrest';
import { supabase } from './supabase';

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('No data returned');
  return result.data;
}

/**
 * Whether this project has had `…_avatars.sql` applied.
 *
 * Selecting a column Postgres does not have makes PostgREST reject the whole
 * request, so a single missing column took the entire feed down rather than
 * costing one picture — the same failure mode `profile_completed` had on the
 * sign-up screen. Every read that wants a group's photo asks for it once,
 * and if the column is not there, stops asking and re-runs without it.
 *
 * Starts undecided rather than optimistic-per-call so one probe answers it
 * for the session.
 */
let groupAvatars: 'unknown' | 'yes' | 'no' = 'unknown';


/**
 * Runs a read, and retries it without the group photo if that is what the
 * project is missing. `build` is called again for the retry so the caller can
 * hand back a fresh query — a PostgREST builder cannot be re-awaited.
 */
async function withGroupAvatarFallback<T>(
  build: (withAvatar: boolean) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>
): Promise<T> {
  const first = await build(groupAvatars !== 'no');

  if (first.error && groupAvatars !== 'no' && isMissingColumn(first.error, 'avatar_url')) {
    groupAvatars = 'no';
    const retry = await build(false);
    if (retry.error) throw new Error(retry.error.message);
    if (retry.data === null) throw new Error('No data returned');
    return retry.data;
  }

  if (first.error) throw new Error(first.error.message);
  if (first.data === null) throw new Error('No data returned');
  if (groupAvatars === 'unknown') groupAvatars = 'yes';
  return first.data;
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

/**
 * Sets a group's picture. Separate from `create_group` because the upload path
 * contains the group id, so the row has to exist before there is anything to
 * point at — the same ordering bet media has.
 */
export async function updateGroupAvatar(
  groupId: string,
  avatarUrl: string | null
): Promise<GroupRow> {
  if (isDemoMode()) return demo.updateGroupAvatar(groupId, avatarUrl);

  const { data, error } = await supabase
    .from('groups')
    .update({ avatar_url: avatarUrl })
    .eq('id', groupId)
    .select()
    .single();

  // Reads fall back silently, but a write cannot: the user asked for the
  // picture to be saved and it was not. Say what is actually wrong.
  if (error && isMissingColumn(error, 'avatar_url')) {
    groupAvatars = 'no';
    throw new Error(
      'Group photos need the avatars migration. Run supabase/migrations/20260906090000_avatars.sql on your project.'
    );
  }
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('No data returned');
  return data as GroupRow;
}

export async function joinGroupWithCode(code: string): Promise<GroupRow> {
  if (isDemoMode()) return demo.joinGroupWithCode(code);
  const group = unwrap(
    await supabase.rpc('join_group_with_code', { p_code: code }).single()
  ) as GroupRow;

  // Fire-and-forget: you have joined either way, and the group hearing about
  // it is not something worth failing the join over.
  void announceGroupJoin(group.id).catch(() => {});

  return group;
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

// `bet_options!bet_options_bet_id_fkey` names the foreign key to embed on, and
// it has to. There are *two* keys between `bets` and `bet_options` — the one
// every option has back to its bet, and `bets.winning_option_id` pointing the
// other way — so an unqualified `bet_options(*)` is ambiguous and PostgREST
// rejects the whole select with "more than one relationship was found". It
// takes the entire feed down with it, because a failed select returns no rows
// at all rather than rows without the embed.
const BET_SELECT =
  '*, options:bet_options!bet_options_bet_id_fkey(*), positions:bet_positions(user_id, side, option_id), media:bet_media(*)';
const betSelectWithGroup = (withAvatar: boolean) =>
  `${BET_SELECT}, group:groups(id, name, emoji${withAvatar ? ', avatar_url' : ''})`;

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
  const data = await withGroupAvatarFallback((withAvatar) =>
    supabase
      .from('bets')
      .select(betSelectWithGroup(withAvatar))
      .in('status', ['open', 'locked'])
      .order('created_at', { ascending: false })
      .limit(100)
  );

  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

export async function fetchBet(betId: string): Promise<BetWithPositions> {
  if (isDemoMode()) return demo.fetchBet(betId);
  const bet = (await withGroupAvatarFallback((withAvatar) =>
    supabase.from('bets').select(betSelectWithGroup(withAvatar)).eq('id', betId).single()
  )) as unknown as BetWithPositions;

  const [withMedia] = await attachSignedMedia([bet]);
  return withMedia ?? bet;
}

export interface NewBetInput {
  groupId: string;
  creatorId: string;
  title: string;
  description: string | null;
  /** Two or more, in display order. */
  optionLabels: string[];
  totalPotAgorot: number;
  closeAt: string | null;
  /** Photos and videos picked on the new-bet screen, uploaded after insert. */
  media?: PickedMedia[];
}

/** Two is the floor; a bet with one option is not a bet. */
export const MIN_BET_OPTIONS = 2;
/** Past this the odds bar stops being readable and the pot slices get silly. */
export const MAX_BET_OPTIONS = 8;

export async function createBet(input: NewBetInput): Promise<BetRow> {
  if (isDemoMode()) return demo.createBet(input);

  const labels = input.optionLabels.map((label) => label.trim()).filter(Boolean);
  if (labels.length < MIN_BET_OPTIONS) {
    throw new Error('A bet needs at least two options.');
  }

  // The first two labels go on the bet row, where they always have. A trigger
  // turns them into options 0 and 1, so a bet is never left unjoinable even if
  // the inserts below fail — and a client built before options existed still
  // reads the bet correctly.
  const bet = unwrap(
    await supabase
      .from('bets')
      .insert({
        group_id: input.groupId,
        creator_id: input.creatorId,
        title: input.title,
        description: input.description,
        option_a_label: labels[0],
        option_b_label: labels[1],
        total_pot_agorot: input.totalPotAgorot,
        close_at: input.closeAt,
      })
      .select()
      .single()
  ) as BetRow;

  const extra = labels.slice(2);
  if (extra.length > 0) {
    const { error } = await supabase.from('bet_options').insert(
      extra.map((label, index) => ({ bet_id: bet.id, position: index + 2, label }))
    );
    if (error) throw new Error(error.message);
  }

  // Media is uploaded after the bet exists: its id is part of the storage
  // path, which is what lets the bucket policy check group membership. A
  // failure here leaves the bet posted without its attachments rather than
  // losing the bet, which is the better of the two failures.
  if (input.media?.length) {
    await attachMediaToBet(bet, input.media, input.creatorId);
  }

  // Announced from here rather than from the screen: a caller that forgets is
  // a bet nobody hears about, and there is no reason for that to be possible.
  // After the media, so the push and the card people open agree.
  void announceNewBet(bet.id).catch(() => {});

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

/** Back one of a bet's options. Switching sides is the same call. */
export async function joinBetOption(betId: string, optionId: string): Promise<void> {
  if (isDemoMode()) return demo.joinBetOption(betId, optionId);
  const { error } = await supabase.rpc('join_bet_option', {
    p_bet_id: betId,
    p_option_id: optionId,
  });
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
 * Declare a winner and write the ledger.
 *
 * This used to call the `resolve-bet` Edge Function, which meant resolving
 * anything at all required that function to be deployed — and when it was not,
 * the app said "Failed to send a request to the Edge Function" and there was
 * no way past it. It also inserted the ledger rows and *then* flipped the bet,
 * so a failure between the two left a bet that could never be resolved,
 * settled or cancelled.
 *
 * The maths still runs in exactly one place: `computeBetPayouts`, the
 * unit-tested module the Edge Function used, imported here through
 * `@/lib/payout`. What changed is who calls it and what happens to the result
 * — a single RPC that writes both the ledger and the status in one
 * transaction, and refuses any set of entries that does not have the
 * properties that module guarantees (one per participant, winners paid, losers
 * charged, both totals exactly the pot). See `…_bet_options.sql`.
 */
export async function resolveBet(
  betId: string,
  winningOptionId: string
): Promise<ResolveBetResult> {
  if (isDemoMode()) return demo.resolveBet(betId, winningOptionId);

  // Read the bet back rather than trusting what the screen is holding: the
  // ledger is written from these positions, so they have to be the current
  // ones, not whatever was on screen when it was opened.
  const bet = await fetchBet(betId);

  const payout = computeBetPayouts(
    bet.total_pot_agorot,
    (bet.positions ?? []).map((p) => ({ userId: p.user_id, side: p.option_id })),
    winningOptionId
  );

  const { error } = await supabase.rpc('resolve_bet_with_entries', {
    p_bet_id: betId,
    p_winning_option_id: winningOptionId,
    p_entries: payout.entries.map((entry) => ({
      user_id: entry.userId,
      amount_agorot: entry.amountAgorot,
    })),
  });

  if (error) throw new Error(error.message);

  // Best-effort: everyone who took a side gets told. A missing deployment
  // costs the push, never the resolution.
  void announceBetResolved(betId).catch(() => {});

  return {
    paidOut: payout.paidOut,
    winnerCount: payout.winnerCount,
    loserCount: payout.loserCount,
  };
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
  group: Pick<GroupRow, 'id' | 'name' | 'emoji' | 'avatar_url'>;
}

export async function fetchMyHistory(userId: string): Promise<HistoryEntry[]> {
  if (isDemoMode()) return demo.fetchMyHistory(userId);
  const data = await withGroupAvatarFallback((withAvatar) =>
    supabase
      .from('bet_ledger_entries')
      .select(
        'id, amount_agorot, created_at, bet:bets(id, title, winning_option, option_a_label, option_b_label, resolved_at), ' +
          `group:groups(id, name, emoji${withAvatar ? ', avatar_url' : ''})`
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
  );

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
