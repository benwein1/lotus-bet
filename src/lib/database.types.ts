/**
 * Hand-written mirror of the Postgres schema in `supabase/migrations`.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 * Kept by hand for now so the repo type-checks without a live project.
 */

/**
 * The option a position backs.
 *
 * A bet used to have exactly two, spelled 'a' and 'b'. It can have any number
 * now, and an option is identified by its row id — see `BetOptionRow`. The
 * letters survive on the first two options only, so that data written before
 * options existed still reads.
 */
export type BetSide = 'a' | 'b';
export type BetStatus = 'open' | 'locked' | 'resolved' | 'cancelled';
export type GroupRole = 'admin' | 'member';

export interface UserRow {
  id: string;
  /**
   * **Never present on a row the client read.** `email`, `phone` and
   * `expo_push_token` are revoked from `authenticated` at the column level by
   * `…_user_column_privileges.sql`, because RLS is row-level and could not
   * stop a group member reading them off everyone else's row.
   *
   * They stay on the type because the row still has them server-side — the
   * signup trigger writes `email`, `push_targets_*` reads the token — and
   * because a `SECURITY DEFINER` function is unaffected by the grant. For the
   * signed-in user's own address, read `session.user.email` from GoTrue, which
   * is what this column was only ever a mirror of.
   */
  email?: string | null;
  /** Kept for the accounts created under the old phone-OTP flow. Never read. */
  phone?: string | null;
  display_name: string;
  /**
   * The handle other people challenge you by. Assigned on signup and
   * backfilled for older accounts, so it is only optional for a project that
   * has not applied `…_private_and_duels.sql` yet.
   */
  username?: string | null;
  /**
   * False until the user has actually named themselves.
   *
   * Optional because a project that has not yet had `…_email_auth.sql` applied
   * has no such column, and `select('*')` simply returns a row without it.
   * `profileIsComplete` in the auth provider is the only place that reads it.
   */
  profile_completed?: boolean;
  avatar_url: string | null;
  /** Never present on a client-read row — see `email` above. */
  expo_push_token?: string | null;
  notify_new_bets: boolean;
  notify_resolutions: boolean;
  /**
   * The two switches added with the second pass of notifications. Optional for
   * the same reason `profile_completed` is: a project that has not applied
   * `…_notification_prefs.sql` returns a row without them, and every read site
   * treats a missing value as on.
   */
  notify_group_joins?: boolean;
  notify_deadlines?: boolean;
  created_at: string;
}

export interface GroupRow {
  id: string;
  name: string;
  /**
   * A `duel` is the two-person group behind a one-on-one challenge. It is a
   * real group — same policies, same balances, same settle-up — just hidden
   * from the Groups tab and shown under the other person's name.
   */
  kind?: 'group' | 'duel';
  emoji: string | null;
  /** Public URL in the `avatars` bucket. Null means fall back to `emoji`. */
  avatar_url?: string | null;
  created_by: string;
  invite_code: string;
  created_at: string;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
}

/**
 * A shareable link into a group.
 *
 * Separate from `groups.invite_code` rather than replacing it: the six-
 * character code is the thing you read out loud in a room, and it never
 * expires because it does not travel. A link does travel — into a chat that
 * gets scrolled back through a year later — so it carries an expiry, a use
 * count and a revocation.
 */
export interface GroupInviteRow {
  id: string;
  group_id: string;
  token: string;
  created_by: string;
  expires_at: string;
  revoked_at: string | null;
  /** Null means the link works for as many people as it reaches. */
  max_uses: number | null;
  uses: number;
  created_at: string;
}

export interface BetRow {
  id: string;
  group_id: string;
  creator_id: string;
  title: string;
  description: string | null;
  /**
   * The first two options, also mirrored as `bet_options` rows 0 and 1.
   * Still NOT NULL, so every bet has at least two options no matter what
   * wrote it. Render from `options`, not from these.
   */
  option_a_label: string;
  option_b_label: string;
  total_pot_agorot: number;
  status: BetStatus;
  /** `private` means only the creator and the invitees can see it at all. */
  visibility?: 'group' | 'private';
  /** Only meaningful when the winner was one of the first two options. */
  winning_option: BetSide | null;
  /** The option that won. This is what "resolved" actually means. */
  winning_option_id?: string | null;
  close_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface BetOptionRow {
  id: string;
  bet_id: string;
  /** Display order. 0 and 1 mirror the label columns on `bets`. */
  position: number;
  label: string;
  created_at: string;
}

export type BetMediaKind = 'image' | 'video';

/**
 * Why a file is attached to a bet.
 *
 * `attachment` is the creator's illustration, posted with the bet while it is
 * open. `proof` is the receipt — added by somebody who actually had a side in
 * it, only once the bet has been called. Same bucket, same path, same viewer;
 * different rules about when it may be written and where it is shown.
 */
export type BetMediaPurpose = 'attachment' | 'proof';

export interface BetMediaRow {
  id: string;
  bet_id: string;
  group_id: string;
  uploaded_by: string;
  kind: BetMediaKind;
  /** Older rows predate the column and read as `attachment`, which they are. */
  purpose?: BetMediaPurpose;
  /** Path inside the private `bet-media` bucket. Signed on read. */
  storage_path: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  position: number;
  created_at: string;
}

export interface BetPositionRow {
  bet_id: string;
  user_id: string;
  /** Null past the second option — there is no letter for a third. */
  side: BetSide | null;
  option_id: string;
  joined_at: string;
}

export interface BetLedgerEntryRow {
  id: string;
  bet_id: string;
  group_id: string;
  user_id: string;
  amount_agorot: number;
  created_at: string;
}

export interface SettlementConfirmationRow {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_agorot: number;
  confirmed_by: string;
  created_at: string;
}

/** Row shape returned by the `group_balances(uuid)` RPC. */
export interface GroupBalanceRow {
  user_id: string;
  amount_agorot: number;
}

/** Row shape returned by the `my_stats()` RPC. */
export interface MyStatsRow {
  total_won_agorot: number;
  total_lost_agorot: number;
  bets_won: number;
  bets_lost: number;
  bets_settled: number;
  most_active_group_id: string | null;
}

// --- View models assembled client-side -------------------------------------

export interface GroupSummary extends GroupRow {
  memberCount: number;
  /** Signed agorot for the signed-in user in this group. */
  myBalanceAgorot: number;
}

/** A media row with a short-lived signed URL attached, ready to render. */
export interface BetMedia extends BetMediaRow {
  url: string;
}

export interface BetInviteeRow {
  bet_id: string;
  user_id: string;
}

/** What `find_user_by_username` hands back — deliberately the minimum. */
export interface UserLookup {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
}

export interface BetLikeRow {
  bet_id: string;
  user_id: string;
  created_at: string;
}

export interface BetCommentRow {
  id: string;
  bet_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

/** A comment with its author attached, which is the only way one is rendered. */
export interface BetComment extends BetCommentRow {
  author: Pick<UserRow, 'id' | 'display_name' | 'avatar_url'> | null;
}

export interface BetWithPositions extends BetRow {
  positions: { user_id: string; side: BetSide | null; option_id: string }[];
  /** Ordered by `position`. Always at least two. */
  options: BetOptionRow[];
  media?: BetMedia[];
  group?: Pick<GroupRow, 'id' | 'name' | 'emoji' | 'avatar_url'>;
  /**
   * Who liked this. The whole list rather than a count, because the card needs
   * both the number *and* whether you are in it, and at friend-group scale
   * that is a handful of rows either way.
   */
  likes?: { user_id: string }[];
  /** Just the count — the comments themselves are only read on the bet screen. */
  comments?: { count: number }[];
}

/**
 * One bet, with everything the bet screen needs to draw itself.
 *
 * The extra two embeds are the difference between one round trip and three:
 * the option rosters need the group's members, and a called bet needs its
 * ledger rows, and neither could be asked for until the bet itself had come
 * back and named its group and its status.
 */
export interface BetDetail extends BetWithPositions {
  group?: Pick<GroupRow, 'id' | 'name' | 'emoji' | 'avatar_url'> & {
    members?: (GroupMemberRow & { user: UserRow })[];
  };
  ledger?: BetLedgerEntryRow[];
}

/**
 * What one person owes another, netted across every group they share.
 *
 * Derived from `simplifyDebts`, not stored: there is no such thing as a
 * pairwise debt in the ledger — a bet writes a balance line per person, and
 * who hands money to whom is a suggestion. This is that suggestion, summed per
 * counterparty so Profile and settle-up can never quote different numbers.
 */
export interface PersonBalance {
  user: Pick<UserRow, 'id' | 'display_name' | 'avatar_url'>;
  /** Positive: they owe you. Negative: you owe them. */
  amountAgorot: number;
  /** The groups the figure came from, for the secondary line. */
  groupNames: string[];
}
