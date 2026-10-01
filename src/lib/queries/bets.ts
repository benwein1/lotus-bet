/**
 * Bets: posting, joining, locking, calling, and the media hung off them.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  BetDetail,
  BetMediaPurpose,
  BetMediaRow,
  BetRow,
  BetWithPositions,
} from '../database.types';
import { demo, isDemoMode } from '../demo';
import { orderFeed } from '../feed-order';
import { discardUploads, signMedia, uploadBetMedia, type PickedMedia } from '../media';
import { announceBetResolved, announceNewBet } from '../notifications';
import { computeBetPayouts } from '../payout';
import { prepareContent } from '../content-rules';
import { isUnknownWriteColumn } from '../postgrest';
import { supabase } from '../supabase';
import { unwrap, USER_PUBLIC_COLUMNS, withGroupColumnFallback, type GroupExtras } from './core';
import { blockedIds } from './account';

// --- Bets ------------------------------------------------------------------

// `bet_options!bet_options_bet_id_fkey` names the foreign key to embed on, and
// it has to. There are *two* keys between `bets` and `bet_options` — the one
// every option has back to its bet, and `bets.winning_option_id` pointing the
// other way — so an unqualified `bet_options(*)` is ambiguous and PostgREST
// rejects the whole select with "more than one relationship was found". It
// takes the entire feed down with it, because a failed select returns no rows
// at all rather than rows without the embed.
//
// `bet_likes` and `bet_comments` each have exactly one key back to `bets`, so
// they need no such hint — but check that again before embedding any new table
// that also points at `bets` twice.
export const BET_SELECT =
  '*, options:bet_options!bet_options_bet_id_fkey(*), ' +
  // `joined_at` and the picker's name ride along because the feed card's
  // footer says who moved last and when. It is a name and a timestamp on rows
  // the select already returns, not a second list: the group's *members* are
  // still deliberately absent (see `fetchBet`), because those are a hundred
  // rosters the feed never renders.
  //
  // It is `joined_at` and not `created_at`, which is what this said first.
  // A column that does not exist fails the select exactly the way an ambiguous
  // embed does — PostgREST returns no rows at all — so the feed went empty
  // rather than merely undated. `__tests__/bet-select.test.ts` now reads every
  // column named here against the migrations for that reason.
  'positions:bet_positions(user_id, side, option_id, joined_at, ' +
  'user:users!bet_positions_user_id_fkey(id, display_name, avatar_url)), ' +
  'media:bet_media(*), likes:bet_likes(user_id), comments:bet_comments(count)';
/**
 * `creator` names its foreign key even though `bets` has only one to `users`.
 *
 * The habit is the point: `bet_options` has two keys back to `bets`, and an
 * unnamed embed there makes PostgREST refuse the *whole* select — so the feed
 * comes back empty rather than merely without options. Naming it here costs
 * nothing and means a second `bets → users` key added later cannot silently
 * empty the feed.
 *
 * `currency` rides along because every amount on the card is denominated by the
 * group, not the bet. One embed, no extra round trip.
 */
const betSelectWithGroup = (extras: GroupExtras) =>
  `${BET_SELECT}, creator:users!bets_creator_id_fkey(id, display_name, username, avatar_url)` +
  `, group:groups(id, name, emoji${extras.currency ? ', currency' : ''}${
    extras.avatar ? ', avatar_url' : ''
  })`;

/**
 * The bet screen's select. Same as the feed's, plus the two things that screen
 * used to fetch *afterwards*.
 *
 * The roster under each option needs names and faces, and the ledger needs its
 * rows once the bet is called. Both used to be their own `useAsync`, keyed on
 * something only the first response could tell them — the group id, the status
 * — so opening a bet cost three round trips end to end, each waiting on the
 * one before it. Embedding them makes it one.
 *
 * Deliberately *not* folded into `BET_SELECT`: the feed reads a hundred bets
 * at once and would pay for a hundred copies of a member list it never renders.
 */
const betDetailSelect = (extras: GroupExtras) =>
  `${BET_SELECT}, ledger:bet_ledger_entries(*), group:groups(id, name, emoji${
    extras.currency ? ', currency' : ''
  }${extras.avatar ? ', avatar_url' : ''}, members:group_members(*, user:users(${
    USER_PUBLIC_COLUMNS
  })))`;

/**
 * Media rows arrive as storage paths; the bucket is private, so they have to be
 * signed before anything can render them. Signing is batched across the whole
 * result — a feed of ten bets with photos costs one round trip, not ten.
 */
export async function attachSignedMedia<T extends { media?: BetMediaRow[] | null }>(
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

/** How much settled history the group screen asks for at a time. */
export const GROUP_HISTORY_PAGE = 25;

/** What the group screen draws: the two sections, and whether there is more. */
export type GroupBets = {
  /** Open and locked, in full. */
  live: BetWithPositions[];
  /** Resolved and cancelled, newest first, one page at a time. */
  past: BetWithPositions[];
  /** Whether another page of history exists. */
  morePast: boolean;
};

/**
 * The group screen's bets, in the two sections it actually renders.
 *
 * This used to be one unbounded `select` — SCALEABILITY.md names it as the
 * first query in the app that will feel slow, because a group two years old
 * fetches all 800 bets *with every embed* every time the screen opens.
 *
 * The obvious fix, a `limit` on the whole thing, is wrong here. The screen
 * splits into "Live bets" and "Settled and cancelled", and a limit over the
 * combined list ordered by `created_at` would silently drop an old bet that is
 * still running — which is the one row on the screen somebody might need to
 * act on.
 *
 * So the split moves into the query. Live bets are unbounded because they are
 * bounded by nature: a friend group does not have eighty bets running at once.
 * History is what grows without end, and history is what pages.
 *
 * Two requests rather than one, issued together. Signing is still a single
 * round trip across both, which is what `attachSignedMedia` is for.
 */
export async function fetchGroupBets(
  groupId: string,
  pastLimit = GROUP_HISTORY_PAGE
): Promise<GroupBets> {
  if (isDemoMode()) {
    const all = await demo.fetchGroupBets(groupId);
    return splitGroupBets(
      all.filter((bet) => bet.status !== 'resolved' && bet.status !== 'cancelled'),
      all.filter((bet) => bet.status === 'resolved' || bet.status === 'cancelled'),
      pastLimit
    );
  }

  const [live, past] = await Promise.all([
    supabase
      .from('bets')
      .select(BET_SELECT)
      .eq('group_id', groupId)
      .in('status', ['open', 'locked'])
      .order('created_at', { ascending: false }),
    supabase
      .from('bets')
      .select(BET_SELECT)
      .eq('group_id', groupId)
      .in('status', ['resolved', 'cancelled'])
      .order('created_at', { ascending: false })
      // One more than asked for, which is how the screen knows whether to offer
      // another page without a second count query.
      .limit(pastLimit + 1),
  ]);

  if (live.error) throw new Error(live.error.message);
  if (past.error) throw new Error(past.error.message);

  // Signed in one batch across both lists — ten bets with photos cost one
  // storage round trip, not twenty.
  const signed = await attachSignedMedia([
    ...((live.data ?? []) as unknown as BetWithPositions[]),
    ...((past.data ?? []) as unknown as BetWithPositions[]),
  ]);

  const liveCount = (live.data ?? []).length;
  return splitGroupBets(signed.slice(0, liveCount), signed.slice(liveCount), pastLimit);
}

function splitGroupBets(
  live: BetWithPositions[],
  past: BetWithPositions[],
  pastLimit: number
): GroupBets {
  return {
    live,
    past: past.slice(0, pastLimit),
    morePast: past.length > pastLimit,
  };
}

/** Every bet across every group the user is in — the Home feed's raw input. */
export async function fetchFeedBets(userId?: string): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchFeedBets();
  // One extra round trip for the block list, in parallel with the feed itself
  // rather than before it. See `blockedIds` for why this filter lives here and
  // not in a policy.
  const [data, blocked] = await Promise.all([
    withGroupColumnFallback((extras) =>
      supabase
        .from('bets')
        .select(betSelectWithGroup(extras))
        .in('status', ['open', 'locked'])
        // Newest first here so the 100-row cap takes the most recent hundred.
        // The *display* order is not this — `orderFeed` bands live above closed
        // afterwards, because "live" depends on `close_at` against now and is
        // not a column PostgREST can sort on.
        .order('created_at', { ascending: false })
        .limit(100)
    ),
    blockedIds(),
  ]);

  const bets = ((data ?? []) as unknown as BetWithPositions[]).filter(
    (bet) =>
      !blocked.has(bet.creator_id) ||
      // Still yours to see if your money is on it.
      (bet.positions ?? []).some((p) => p.user_id === userId)
  );

  // Live newest-first, then closed-but-uncalled newest-first. See `feed-order`.
  return orderFeed(await attachSignedMedia(bets));
}

export async function fetchBet(betId: string): Promise<BetDetail> {
  if (isDemoMode()) return demo.fetchBet(betId) as unknown as Promise<BetDetail>;
  const bet = (await withGroupColumnFallback((extras) =>
    supabase.from('bets').select(betDetailSelect(extras)).eq('id', betId).single()
  )) as unknown as BetDetail;

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
  /**
   * A forfeit instead of a pot — "loser buys dinner".
   *
   * Set it and `totalPotAgorot` must be 0; the database refuses a bet that
   * claims both, because two answers to "what is at stake" means every screen
   * has to pick one.
   */
  stakeText?: string | null;
  closeAt: string | null;
  /** Photos and videos picked on the new-bet screen, uploaded after insert. */
  media?: PickedMedia[];
  /**
   * Leave empty for a bet the whole group can see. Naming people makes it
   * private: only they and you can see it, join it, or comment on it.
   */
  inviteeIds?: string[];
}

/** Two is the floor; a bet with one option is not a bet. */
export const MIN_BET_OPTIONS = 2;
/** Past this the odds bar stops being readable and the pot slices get silly. */
export const MAX_BET_OPTIONS = 8;

export async function createBet(input: NewBetInput): Promise<BetRow> {
  // The filter runs before the demo short-circuit, for the same reason it does
  // in `postBetComment`: demo mode must never be more permissive than the real
  // backend.
  //
  // The title is a question everybody in the group reads, and the option
  // labels sit on the buttons they press, so both go through the filter. The
  // description is speech and gets the ordinary threshold.
  const checkedTitle = prepareContent(input.title, { strict: true });
  if (!checkedTitle.ok) throw new Error(checkedTitle.message);

  // A forfeit is free text that everybody in the group reads, so it goes
  // through the same filter the title does, at the same strictness. It is
  // also the most obvious place to try to write something the filter is for.
  let checkedStake: string | null = null;
  if (input.stakeText && input.stakeText.trim()) {
    const checked = prepareContent(input.stakeText, { strict: true });
    if (!checked.ok) throw new Error(checked.message);
    checkedStake = checked.text;
  }

  let checkedDescription: string | null = null;
  if (input.description && input.description.trim()) {
    const checked = prepareContent(input.description);
    if (!checked.ok) throw new Error(checked.message);
    checkedDescription = checked.text;
  }

  const labels: string[] = [];
  for (const raw of input.optionLabels) {
    if (!raw.trim()) continue;
    const checked = prepareContent(raw, { strict: true });
    if (!checked.ok) throw new Error(checked.message);
    labels.push(checked.text);
  }
  if (labels.length < MIN_BET_OPTIONS) {
    throw new Error('A bet needs at least two options.');
  }

  if (isDemoMode()) {
    return demo.createBet({
      ...input,
      title: checkedTitle.text,
      description: checkedDescription,
      stakeText: checkedStake,
      optionLabels: labels,
    });
  }

  // The first two labels go on the bet row, where they always have. A trigger
  // turns them into options 0 and 1, so a bet is never left unjoinable even if
  // the inserts below fail — and a client built before options existed still
  // reads the bet correctly.
  const row = {
    group_id: input.groupId,
    creator_id: input.creatorId,
    title: checkedTitle.text,
    description: checkedDescription,
    option_a_label: labels[0],
    option_b_label: labels[1],
    // Zero when there is a forfeit: the constraint refuses both, and the
    // payout maths then computes no ledger entries, which is the right
    // answer for a bet that moves no money.
    total_pot_agorot: checkedStake ? 0 : input.totalPotAgorot,
    close_at: input.closeAt,
    visibility: (input.inviteeIds?.length ?? 0) > 0 ? 'private' : 'group',
  };

  const post = (values: Record<string, unknown>) =>
    supabase.from('bets').insert(values).select().single();

  let { data, error } = await post({ ...row, stake_text: checkedStake });

  // A project without `…_stake_text.sql` applied has no `stake_text`, and
  // PostgREST rejects the whole insert rather than ignoring the unknown key —
  // so posting *any* bet failed with "Could not find the 'stake_text' column
  // of 'bets' in the schema cache", including a plain money bet that never
  // wanted the column. The retry drops it, exactly as the profile write drops
  // `profile_completed`.
  //
  // Only for a money bet. A forfeit has nowhere else to live: dropping the
  // column would post a bet with a zero pot and no stake at all, which reads
  // as free and is worse than saying what is wrong.
  if (error && isUnknownWriteColumn(error, 'stake_text')) {
    if (checkedStake) {
      throw new Error(
        'Bets staked on something other than money need a database update that has not been applied yet. Set an amount instead, or apply the stake_text migration.'
      );
    }
    ({ data, error } = await post(row));
  }

  const bet = unwrap({ data, error }) as BetRow;

  // Invitees go in before anything else. The bet row already carries
  // `visibility = 'private'`, so it is invisible to the group from the instant
  // it exists — there is no window where it is readable by everyone.
  if (input.inviteeIds?.length) {
    const { error } = await supabase.from('bet_invitees').insert(
      input.inviteeIds.map((userId) => ({ bet_id: bet.id, user_id: userId }))
    );
    if (error) throw new Error(error.message);
  }

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
  uploaderId: string,
  purpose: BetMediaPurpose = 'attachment',
  positionFrom = 0
): Promise<void> {
  const uploaded = [] as {
    bet_id: string;
    group_id: string;
    uploaded_by: string;
    kind: string;
    purpose: BetMediaPurpose;
    storage_path: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    position: number;
  }[];

  // Every path that reaches the bucket, so a failure part way can take them
  // back out again. Without this the objects stay, paid for, with nothing
  // pointing at them and nothing that will ever delete them — CLAUDE.md §7.1.
  const written: string[] = [];

  try {
    for (const [index, item] of media.entries()) {
      const result = await uploadBetMedia(bet.group_id, bet.id, item);
      written.push(result.storagePath);
      uploaded.push({
        bet_id: bet.id,
        group_id: bet.group_id,
        uploaded_by: uploaderId,
        kind: result.kind,
        purpose,
        storage_path: result.storagePath,
        width: result.width,
        height: result.height,
        duration_ms: result.durationMs,
        position: positionFrom + index,
      });
    }

    const { error } = await supabase.from('bet_media').insert(uploaded);
    if (error) throw new Error(error.message);
  } catch (err) {
    // The rows are all-or-nothing — one insert — so a failure here means no
    // row exists for any of these objects. Sweep them and re-throw the real
    // error, which is the one worth showing.
    await discardUploads(written);
    throw err;
  }
}

/**
 * Attach proof of outcome to a bet that has already been called.
 *
 * Deliberately not folded into `createBet`'s media path: that one runs once,
 * owned by the creator, before anybody has seen the bet. This one runs any
 * number of times, from any of the people who had a side, long after the
 * argument started — so it appends rather than replaces, and `position`
 * continues from what is already there instead of restarting at zero and
 * shuffling the gallery every time somebody adds a photo.
 *
 * The RLS policy is the real gate (resolved bet, participant or creator); this
 * only has to hand it well-formed rows.
 */
export async function addBetProof(
  bet: BetRow,
  media: PickedMedia[],
  uploaderId: string,
  existingProofCount = 0
): Promise<void> {
  if (media.length === 0) return;
  if (isDemoMode()) return demo.addBetProof(bet.id, media, existingProofCount);
  await attachMediaToBet(bet, media, uploaderId, 'proof', existingProofCount);
}

export async function deleteBetMedia(mediaId: string): Promise<void> {
  if (isDemoMode()) return demo.deleteBetMedia(mediaId);
  const { error } = await supabase.from('bet_media').delete().eq('id', mediaId);
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

