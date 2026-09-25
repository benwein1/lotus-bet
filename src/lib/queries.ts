/**
 * Every Supabase read/write the app makes, in one place.
 *
 * Screens call these; they never build queries inline. Keeping them together
 * makes the RLS surface easy to audit — if a table is not touched here, the
 * client never reads it.
 */
import type {
  BetComment,
  BlockedUser,
  BetDetail,
  BetLedgerEntryRow,
  BetMediaPurpose,
  BetMediaRow,
  BetRow,
  BetSide,
  BetWithPositions,
  GroupBalanceRow,
  GroupInviteRow,
  GroupMemberRow,
  GroupRow,
  MyStatsRow,
  PersonBalance,
  ReportReason,
  ReportTargetKind,
  UserLookup,
  SettlementConfirmationRow,
  UserRow,
} from './database.types';
import { demo, isDemoMode } from './demo';
import { DEFAULT_CURRENCY, asCurrency, type Currency } from './currency';
import { orderFeed } from './feed-order';
import { discardUploads, signMedia, uploadBetMedia, type PickedMedia } from './media';
import { announceBetResolved, announceGroupJoin, announceNewBet } from './notifications';
import { computeBetPayouts } from './payout';
import { prepareContent } from './content-rules';
import { isMissingColumn, isMissingFunction } from './postgrest';
import { personBalances, type BalanceLine } from './settlement';
import { supabase } from './supabase';

/**
 * The columns of `public.users` a client is allowed to read.
 *
 * Not a tidiness preference — it is half of the fix in
 * `…_user_column_privileges.sql`, and the half that has to live here. RLS is
 * row-level: the policy on `users` decides whether you may see a person at
 * all, and has nothing to say about which of their columns. `users(*)` was
 * therefore handing every group member the email address, phone number and
 * device push token of everyone else in the group.
 *
 * The migration revokes those three at the column level, which makes
 * `select *` on this table an outright error ("permission denied for column
 * email") rather than a quietly narrower row. So every read site names its
 * columns, and there is exactly one list to audit.
 *
 * Adding a column to `users` does **not** add it here. Read the migration
 * before extending this.
 */
const USER_COLUMNS =
  'id, display_name, username, avatar_url, profile_completed, age_verified_at, notify_new_bets, notify_resolutions, notify_group_joins, notify_deadlines, created_at';

/** The subset needed to draw somebody: a name, a handle, a face. */
const USER_PUBLIC_COLUMNS = 'id, display_name, username, avatar_url';

export { USER_COLUMNS, USER_PUBLIC_COLUMNS };

/**
 * Confirm this account meets the 16+ minimum.
 *
 * The date of birth is a parameter and nothing more: `confirm_minimum_age`
 * compares it against `current_date` in SQL and writes only a timestamp, so
 * the birthday is never stored and the check cannot be won by a client that
 * lies about the resulting age. An under-age date throws, which is what the
 * caller renders.
 *
 * For accounts the sign-up form did not cover — Apple and Google return no
 * date of birth — and for every account that predates the migration.
 */
export async function confirmMinimumAge(dateOfBirth: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_minimum_age', {
    p_date_of_birth: dateOfBirth,
  });
  if (error) throw new Error(error.message);
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('No data returned');
  return result.data;
}

/**
 * Which optional columns of `groups` this project actually has.
 *
 * Selecting a column Postgres does not have makes PostgREST reject the whole
 * request, so a single missing column took the entire feed down rather than
 * costing one picture — the same failure mode `profile_completed` had on the
 * sign-up screen. Every read that wants one asks for it once, and if it is not
 * there, stops asking and re-runs without it.
 *
 * There are two now. `avatar_url` arrives with `…_avatars.sql` and `currency`
 * with `…_group_currency.sql`, and a project can be behind on either
 * independently, so they are tracked separately rather than as one "is this
 * project up to date" flag — dropping the photo because the currency is
 * missing would lose something the project does have.
 *
 * Each starts undecided rather than optimistic-per-call, so one probe answers
 * it for the session.
 */
type GroupColumn = 'avatar_url' | 'currency';

const groupColumns: Record<GroupColumn, 'unknown' | 'yes' | 'no'> = {
  avatar_url: 'unknown',
  currency: 'unknown',
};

/** What a caller's select-builder is told to ask for. */
export interface GroupExtras {
  avatar: boolean;
  currency: boolean;
}

function currentGroupExtras(): GroupExtras {
  return {
    avatar: groupColumns.avatar_url !== 'no',
    currency: groupColumns.currency !== 'no',
  };
}

/**
 * Runs a read, dropping whichever optional group column the project turns out
 * not to have and retrying. `build` is called again for each retry so the
 * caller can hand back a fresh query — a PostgREST builder cannot be
 * re-awaited.
 *
 * At most one retry per column, so a project missing both still converges, and
 * a genuine error can never loop.
 */
async function withGroupColumnFallback<T>(
  build: (
    extras: GroupExtras
  ) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>
): Promise<T> {
  const optional: GroupColumn[] = ['avatar_url', 'currency'];

  for (let attempt = 0; attempt <= optional.length; attempt += 1) {
    const extras = currentGroupExtras();
    const result = await build(extras);

    if (!result.error) {
      for (const column of optional) {
        if (groupColumns[column] === 'unknown') groupColumns[column] = 'yes';
      }
      if (result.data === null) throw new Error('No data returned');
      return result.data;
    }

    const culprit = optional.find(
      (column) => groupColumns[column] !== 'no' && isMissingColumn(result.error!, column)
    );
    if (!culprit) throw new Error(result.error.message);
    groupColumns[culprit] = 'no';
  }

  throw new Error('Could not read the group columns');
}

// --- Groups ----------------------------------------------------------------

export interface GroupWithMembers extends GroupRow {
  members: (GroupMemberRow & { user: UserRow })[];
}

/**
 * The groups the Groups tab lists.
 *
 * Duels are excluded: a one-on-one challenge is a real two-person group under
 * the hood, but showing it as a card would turn the tab into a list of every
 * person you have ever bet against. Its bets still appear in the feed, its
 * balances still settle, and it shows up on the Profile ledger by the other
 * person's name — which is where you actually look for it.
 *
 * The filter is written to tolerate a project that has not applied
 * `…_private_and_duels.sql` yet: no `kind` column means no duels exist.
 */
/**
 * Everything the "Groups & challenges" tab lists — groups *and* duels.
 *
 * Duels used to be filtered out here, on the reasoning that the tab would
 * otherwise become a roster of everybody you have ever bet against. What that
 * actually did was strand them: a duel is only reachable from the feed, so the
 * person who was challenged had nowhere to find it once the bet scrolled past,
 * and the person who sent it had no way back to settle up. A challenge you
 * cannot open is a challenge that does not work.
 *
 * They are the same object underneath (`groups.kind = 'duel'`), so they need
 * no second list — the screen groups them under their own heading.
 */
export async function fetchMyGroups(): Promise<GroupWithMembers[]> {
  if (isDemoMode()) return demo.fetchMyGroups();
  const { data, error } = await supabase
    .from('groups')
    .select(`*, members:group_members(*, user:users(${USER_PUBLIC_COLUMNS}))`)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as GroupWithMembers[];
}

/** Every group including duels — what the Profile ledger needs to name them. */
export async function fetchAllMyGroups(): Promise<GroupWithMembers[]> {
  if (isDemoMode()) return demo.fetchAllMyGroups();
  const { data, error } = await supabase
    .from('groups')
    .select(`*, members:group_members(*, user:users(${USER_PUBLIC_COLUMNS}))`)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as GroupWithMembers[];
}

export async function fetchGroup(groupId: string): Promise<GroupWithMembers> {
  if (isDemoMode()) return demo.fetchGroup(groupId);
  return unwrap(
    await supabase
      .from('groups')
      .select(`*, members:group_members(*, user:users(${USER_PUBLIC_COLUMNS}))`)
      .eq('id', groupId)
      .single()
  ) as unknown as GroupWithMembers;
}

export async function createGroup(
  name: string,
  emoji: string | null,
  currency: Currency = DEFAULT_CURRENCY
): Promise<GroupRow> {
  // `strict`: a group name is identity rather than speech. It appears on every
  // card, every feed row and every invite message, so the shouting and
  // repetition thresholds are lower than they are for a comment.
  const checked = prepareContent(name, { strict: true });
  if (!checked.ok) throw new Error(checked.message);

  if (isDemoMode()) return demo.createGroup(checked.text, emoji, currency);
  return unwrap(
    await supabase
      .rpc('create_group', { p_name: checked.text, p_emoji: emoji, p_currency: currency })
      .single()
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
    groupColumns.avatar_url = 'no';
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

/**
 * Mints a shareable invite link for a group, or hands back the live one.
 *
 * The RPC does the reusing, not this — otherwise two taps a second apart on
 * two devices would make two links. See `create_group_invite`.
 */
export async function createGroupInvite(groupId: string): Promise<GroupInviteRow> {
  if (isDemoMode()) return demo.createGroupInvite(groupId);
  return unwrap(
    await supabase.rpc('create_group_invite', { p_group_id: groupId }).single()
  ) as GroupInviteRow;
}

export async function revokeGroupInvite(token: string): Promise<void> {
  if (isDemoMode()) return demo.revokeGroupInvite(token);
  const { error } = await supabase.rpc('revoke_group_invite', { p_token: token });
  if (error) throw new Error(error.message);
}

export async function joinGroupWithInvite(token: string): Promise<GroupRow> {
  if (isDemoMode()) return demo.joinGroupWithInvite(token);
  const group = unwrap(
    await supabase.rpc('join_group_with_invite', { p_token: token }).single()
  ) as GroupRow;

  // Same as the code path: you are in either way, and the group hearing about
  // it is not worth failing the join over.
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
//
// `bet_likes` and `bet_comments` each have exactly one key back to `bets`, so
// they need no such hint — but check that again before embedding any new table
// that also points at `bets` twice.
const BET_SELECT =
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
      optionLabels: labels,
    });
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
        title: checkedTitle.text,
        description: checkedDescription,
        option_a_label: labels[0],
        option_b_label: labels[1],
        total_pot_agorot: input.totalPotAgorot,
        close_at: input.closeAt,
        visibility: (input.inviteeIds?.length ?? 0) > 0 ? 'private' : 'group',
      })
      .select()
      .single()
  ) as BetRow;

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

// --- Challenges ------------------------------------------------------------

/**
 * Find somebody by their exact handle.
 *
 * Still exact, and still the call `createDuel` is checked against. The
 * autocomplete below is a separate, deliberately narrower endpoint — this one
 * answers "is this handle real", which is a different question from "who
 * starts with these letters".
 *
 * Returns null when nobody has it, which the screen shows as "no one is using
 * that username" — the same answer whether the handle is free or simply not
 * yours to see.
 */
export async function findUserByUsername(username: string): Promise<UserLookup | null> {
  if (isDemoMode()) return demo.findUserByUsername(username);

  const handle = username.trim().replace(/^@/, '');
  if (!handle) return null;

  const { data, error } = await supabase
    .rpc('find_user_by_username', { p_username: handle })
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as UserLookup | null) ?? null;
}

/**
 * Prefix autocomplete over handles, for the challenge screen.
 *
 * This reverses what CLAUDE.md §1 said, on the owner's call, and the reversal
 * is narrow on purpose. `search_users_by_username` is prefix-only, refuses a
 * query under two characters, returns ten rows at most, and hands back only
 * the handle, the display name and the avatar — the head of
 * `…_username_search.sql` has the whole reasoning, including what it does not
 * protect against (there is no rate limit on it yet).
 *
 * The floor is enforced in SQL, not here; this copy of it only avoids a round
 * trip that is certain to come back empty.
 */
export async function searchUsersByUsername(query: string): Promise<UserLookup[]> {
  const handle = query.trim().replace(/^@/, '');
  if (handle.length < 2) return [];

  if (isDemoMode()) return demo.searchUsersByUsername(handle);

  const { data, error } = await supabase.rpc('search_users_by_username', { p_query: handle });

  if (error) throw new Error(error.message);
  return (data as UserLookup[] | null) ?? [];
}

/**
 * Challenge somebody by handle, and get back the group their bets live in.
 *
 * Calling it twice with the same person returns the same group rather than a
 * second one — otherwise a running total with one friend would fragment across
 * a dozen identical groups and the Profile ledger would stop meaning anything.
 */
export async function createDuel(username: string): Promise<GroupRow> {
  if (isDemoMode()) return demo.createDuel(username);

  const handle = username.trim().replace(/^@/, '');
  const { data, error } = await supabase
    .rpc('create_duel', { p_username: handle })
    .single();

  if (error) throw new Error(error.message);
  return data as GroupRow;
}

// --- Likes and comments ----------------------------------------------------

/**
 * Like or unlike, decided by what you want the result to be rather than by
 * what is currently there.
 *
 * The caller already knows whether the heart was filled — it just tapped it —
 * and passing that in means no read before the write, so the heart never
 * lags a round trip behind the finger. The primary key makes a double-insert
 * a no-op rather than a second like, so a fast double-tap is harmless.
 */
export async function setBetLike(
  betId: string,
  userId: string,
  liked: boolean
): Promise<void> {
  if (isDemoMode()) return demo.setBetLike(betId, userId, liked);

  const { error } = liked
    ? await supabase
        .from('bet_likes')
        .upsert({ bet_id: betId, user_id: userId }, { onConflict: 'bet_id,user_id' })
    : await supabase.from('bet_likes').delete().eq('bet_id', betId).eq('user_id', userId);

  if (error) throw new Error(error.message);
}

export async function fetchBetComments(betId: string): Promise<BetComment[]> {
  if (isDemoMode()) return demo.fetchBetComments(betId);

  const { data, error } = await supabase
    .from('bet_comments')
    .select('*, author:users(id, display_name, avatar_url)')
    .eq('bet_id', betId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BetComment[];
}

export async function postBetComment(
  betId: string,
  userId: string,
  body: string
): Promise<BetComment> {
  // Guideline 1.2's "method for filtering objectionable material". It stores
  // the *cleaned* string rather than the raw one, which is the whole reason
  // `prepareContent` returns text — validating one string and writing another
  // lets every invisible character through the check it just passed.
  //
  // Above the demo short-circuit on purpose. Demo mode is scaffolding, and the
  // one thing it must never do is behave *more permissively* than the real
  // backend — that is how a rule gets tested in the demo, looks fine, and is
  // missing in production. Same reason resolving a bet there runs the real
  // payout maths.
  const checked = prepareContent(body);
  if (!checked.ok) throw new Error(checked.message);

  if (isDemoMode()) return demo.postBetComment(betId, userId, checked.text);

  const { data, error } = await supabase
    .from('bet_comments')
    .insert({ bet_id: betId, user_id: userId, body: checked.text })
    .select('*, author:users(id, display_name, avatar_url)')
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as BetComment;
}

export async function deleteBetComment(commentId: string): Promise<void> {
  if (isDemoMode()) return demo.deleteBetComment(commentId);
  const { error } = await supabase.from('bet_comments').delete().eq('id', commentId);
  if (error) throw new Error(error.message);
}

// --- Profile ---------------------------------------------------------------

/**
 * Every person you owe, or who owes you, netted across all of your groups.
 *
 * One round trip for the balances (`my_group_balances`), one for the names.
 * The netting itself is `personBalances`, which runs the same `simplifyDebts`
 * the settle-up screen runs — so a figure here and a figure there can never
 * disagree, which they would within a week if this were reimplemented in SQL.
 */
export async function fetchMyPersonBalances(userId: string): Promise<PersonBalance[]> {
  if (isDemoMode()) return demo.fetchMyPersonBalances(userId);

  const { data, error } = await supabase.rpc('my_group_balances');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { group_id: string; user_id: string; amount_agorot: number }[];
  if (rows.length === 0) return [];

  // All of them, duels included: the Groups tab hides duels, but what you owe
  // somebody one-on-one is exactly what this ledger is for.
  const groups = await fetchAllMyGroups();
  const nameByGroup = new Map(
    groups.map((g) => [
      g.id,
      // A duel's stored name is "You v Them", which would read as a stutter
      // beside the row's own heading — which is already their name.
      g.kind === 'duel' ? 'Just the two of you' : g.name,
    ])
  );

  const currencyByGroup = new Map(groups.map((g) => [g.id, g.currency ?? null]));

  const byGroup = new Map<string, BalanceLine[]>();
  for (const row of rows) {
    const lines = byGroup.get(row.group_id) ?? [];
    // `bigint` comes back from PostgREST as a string often enough that every
    // read site coerces it. Keep doing that.
    lines.push({ userId: row.user_id, amountAgorot: Number(row.amount_agorot) });
    byGroup.set(row.group_id, lines);
  }

  const totals = personBalances(
    [...byGroup.entries()].map(([groupId, balances]) => ({
      groupId,
      groupName: nameByGroup.get(groupId) ?? 'A group',
      // Without this every group nets as the default and a dollar group's
      // figure is added to a shekel one. `personBalances` keys on it.
      currency: currencyByGroup.get(groupId) ?? null,
      balances,
    })),
    userId
  );
  if (totals.length === 0) return [];

  const { data: people, error: peopleError } = await supabase
    .from('users')
    .select('id, display_name, avatar_url')
    .in('id', totals.map((t) => t.userId));

  if (peopleError) throw new Error(peopleError.message);
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  return totals.map((total) => ({
    user: byId.get(total.userId) ?? {
      id: total.userId,
      display_name: 'Someone',
      avatar_url: null,
    },
    amountAgorot: total.amountAgorot,
    currency: total.currency,
    groupNames: total.groupNames,
  }));
}

export interface HistoryEntry {
  id: string;
  amount_agorot: number;
  created_at: string;
  bet: Pick<BetRow, 'id' | 'title' | 'winning_option' | 'option_a_label' | 'option_b_label' | 'resolved_at'>;
  group: Pick<GroupRow, 'id' | 'name' | 'emoji' | 'avatar_url' | 'currency'>;
}

export async function fetchMyHistory(userId: string): Promise<HistoryEntry[]> {
  if (isDemoMode()) return demo.fetchMyHistory(userId);
  const data = await withGroupColumnFallback((extras) =>
    supabase
      .from('bet_ledger_entries')
      .select(
        'id, amount_agorot, created_at, bet:bets(id, title, winning_option, option_a_label, option_b_label, resolved_at), ' +
          `group:groups(id, name, emoji${extras.currency ? ', currency' : ''}${
            extras.avatar ? ', avatar_url' : ''
          })`
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
  );

  return (data ?? []) as unknown as HistoryEntry[];
}

/** How many of your own bets the Profile grid asks for at a time. */
export const MY_BETS_PAGE = 30;

/**
 * The bets you started, newest first.
 *
 * Authorship, not participation — `fetchMyHistory` already answers "what have
 * I been in", and this answers "what have I put up", which is the question a
 * profile grid is really asking. A bet you created but never took a side on
 * still belongs to you and still appears.
 *
 * No group filter: your bets span every group you are in, duels included, and
 * RLS decides what comes back the same way it does everywhere else.
 */
export async function fetchMyBets(
  userId: string,
  limit = MY_BETS_PAGE
): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchMyBets(userId, limit);

  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT)
    .eq('creator_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

/**
 * The bets you took a side on, newest first — the Profile's "Joined" tab.
 *
 * Two round trips rather than one embed, deliberately. `BET_SELECT` already
 * embeds `bet_positions`, so filtering on a second embed of the same table
 * would need an alias PostgREST resolves differently depending on which
 * foreign key it picks, and getting that wrong returns an empty list rather
 * than an error. Asking for the ids first is longer on the wire and impossible
 * to misread. It is also behind a tab rather than on first paint, which is
 * where the embed rule is actually paying for itself.
 */
export async function fetchBetsIJoined(
  userId: string,
  limit = MY_BETS_PAGE
): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchBetsIJoined(userId, limit);

  const positions = await supabase
    .from('bet_positions')
    .select('bet_id')
    .eq('user_id', userId)
    // `joined_at`, not `created_at` — see `BET_SELECT`. Naming a column that
    // does not exist does not drop the ordering, it rejects the request, so
    // the Joined tab came back empty rather than unsorted.
    .order('joined_at', { ascending: false })
    .limit(limit);

  if (positions.error) throw new Error(positions.error.message);
  const ids = Array.from(new Set((positions.data ?? []).map((row) => row.bet_id)));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT)
    .in('id', ids)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

/** The last words on a bet, as the feed card's footer prints them. */
export interface FeedComment {
  id: string;
  bet_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author: { display_name: string; avatar_url: string | null } | null;
}

/**
 * The newest comments across a page of bets, in one read.
 *
 * The alternative was an embed on `BET_SELECT`, and PostgREST cannot limit an
 * embed per parent — a feed of a hundred bets would come back with every
 * comment on all of them. One flat query ordered newest-first with a hard cap
 * is bounded no matter how loud the groups are; the card takes the last two it
 * was given and the full thread is one tap away either way.
 */
export async function fetchFeedComments(
  betIds: string[],
  cap = 240
): Promise<Map<string, FeedComment[]>> {
  const grouped = new Map<string, FeedComment[]>();
  if (betIds.length === 0) return grouped;
  if (isDemoMode()) return demo.fetchFeedComments(betIds);

  const { data, error } = await supabase
    .from('bet_comments')
    .select('id, bet_id, user_id, body, created_at, author:users(display_name, avatar_url)')
    .in('bet_id', betIds)
    .order('created_at', { ascending: false })
    .limit(cap);

  // A footer that could not load is not worth failing a feed over: the card
  // renders without it and the thread is still one tap away.
  if (error) return grouped;

  for (const row of (data ?? []) as unknown as FeedComment[]) {
    const list = grouped.get(row.bet_id);
    // Oldest first within a bet, so the card can take the last two.
    if (list) list.unshift(row);
    else grouped.set(row.bet_id, [row]);
  }
  return grouped;
}

export async function fetchMyStats(): Promise<MyStatsRow | null> {
  if (isDemoMode()) return demo.fetchMyStats();
  const { data, error } = await supabase.rpc('my_stats');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MyStatsRow[];
  return rows[0] ?? null;
}

/** Won and lost, per currency. Normally one row. */
export interface CurrencyTotal {
  currency: Currency;
  wonAgorot: number;
  lostAgorot: number;
  /** Won minus lost, in the same minor units. */
  netAgorot: number;
}

/**
 * Lifetime money, split by what it is denominated in.
 *
 * `my_stats`'s own `total_won_agorot` / `total_lost_agorot` sum across every
 * group regardless of currency, which stopped being a true number the moment a
 * group could be created in dollars. Its *counts* are still read from there,
 * because a bet won is a bet won in any currency — see the head of
 * `…_stats_by_currency.sql`.
 *
 * A project that has not applied that migration has no such function, and this
 * returns an empty list rather than throwing: the profile falls back to
 * `my_stats`, which is exactly right for the all-ILS account such a project
 * necessarily has.
 */
export async function fetchMyTotalsByCurrency(): Promise<CurrencyTotal[]> {
  if (isDemoMode()) return demo.fetchMyTotalsByCurrency();

  const { data, error } = await supabase.rpc('my_totals_by_currency');
  if (error) {
    if (isMissingFunction(error)) return [];
    throw new Error(error.message);
  }

  const rows = (data ?? []) as {
    currency: string;
    total_won_agorot: number;
    total_lost_agorot: number;
  }[];

  // `bigint` arrives as a string from PostgREST often enough that every read
  // site coerces it. Keep doing that.
  return rows.map((row) => {
    const won = Number(row.total_won_agorot);
    const lost = Number(row.total_lost_agorot);
    return { currency: asCurrency(row.currency), wonAgorot: won, lostAgorot: lost, netAgorot: won - lost };
  });
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

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * File a report.
 *
 * An RPC rather than an insert, and the reason is worth keeping in view: the
 * client does **not** say who is being reported. The function resolves that
 * from the target, because a client-supplied `reported_user_id` would let
 * anybody file a complaint against anybody. It also refuses a target the
 * caller cannot see, with the same error it gives for one that does not exist,
 * so the report endpoint is not an oracle for whether a private bet exists.
 *
 * Repeat taps are idempotent — one open report per person per thing, or a
 * single determined user can bury the queue.
 */
export async function reportContent(
  targetKind: ReportTargetKind,
  targetId: string,
  reason: ReportReason
): Promise<void> {
  if (isDemoMode()) return demo.reportContent(targetKind, targetId, reason);
  const { error } = await supabase.rpc('report_content', {
    p_target_kind: targetKind,
    p_target_id: targetId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * Block somebody.
 *
 * Mutual invisibility, not a mute: their comments stop reaching you and yours
 * stop reaching them. Enforced by the policy on `bet_comments`, not here —
 * filtering in the client would leave the rows on the device and the next
 * screen that forgets to filter would re-expose them.
 *
 * It is not a membership change and it does not touch the ledger. A debt does
 * not disappear because two people stopped speaking.
 */
export async function blockUser(userId: string): Promise<void> {
  if (isDemoMode()) return demo.blockUser(userId);
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function unblockUser(userId: string): Promise<void> {
  if (isDemoMode()) return demo.unblockUser(userId);
  const { error } = await supabase.rpc('unblock_user', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

/** Everyone you have blocked, so Profile can offer to undo it. */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  if (isDemoMode()) return demo.fetchBlockedUsers();
  const { data, error } = await supabase.rpc('my_blocked_users');
  if (error) throw new Error(error.message);
  return (data ?? []) as BlockedUser[];
}

/**
 * The ids you have blocked, for the one thing the database cannot decide.
 *
 * A blocked person's *comments* are gone at the policy level, which is where a
 * boundary belongs. Their *bets* are a different kind of object: a bet is a
 * group's shared financial record, and hiding one you have money on would
 * leave you owing against something you cannot open. So the feed drops their
 * bets only where you have no position — a display choice, made here, and
 * deliberately not a policy.
 */
async function blockedIds(): Promise<Set<string>> {
  try {
    const blocked = await fetchBlockedUsers();
    return new Set(blocked.map((b) => b.id));
  } catch {
    // A project without the moderation migration has no such function. An
    // unfiltered feed is the right failure here — blank is worse.
    return new Set();
  }
}

/**
 * Deletes the signed-in account.
 *
 * Takes no argument on purpose: there is nothing to point at somebody else.
 * The RPC reads `auth.uid()` and nothing but.
 *
 * What it does is **scrub, not erase** — see
 * `…_account_deletion.sql`. The `auth.users` row genuinely goes, so the
 * account cannot sign in and the email is freed; the profile row survives with
 * every personal field removed, because `bet_ledger_entries` points at it and
 * those rows are what everyone *else*'s balance is computed from. Deleting
 * them would not erase one person's data, it would silently change what four
 * other people owe each other.
 *
 * The caller must sign out immediately afterwards: the JWT stays valid until
 * it expires, and there is no longer an account behind it.
 */
export async function deleteAccount(): Promise<void> {
  if (isDemoMode()) return demo.deleteAccount();
  const { error } = await supabase.rpc('delete_account');
  if (error) throw new Error(error.message);
}
