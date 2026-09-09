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
  /** Set for accounts created with email + password, which is all of them now. */
  email: string | null;
  /** Kept for the accounts created under the old phone-OTP flow. */
  phone: string | null;
  display_name: string;
  /**
   * False until the user has actually named themselves.
   *
   * Optional because a project that has not yet had `…_email_auth.sql` applied
   * has no such column, and `select('*')` simply returns a row without it.
   * `profileIsComplete` in the auth provider is the only place that reads it.
   */
  profile_completed?: boolean;
  avatar_url: string | null;
  expo_push_token: string | null;
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

export interface BetMediaRow {
  id: string;
  bet_id: string;
  group_id: string;
  uploaded_by: string;
  kind: BetMediaKind;
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

export interface BetWithPositions extends BetRow {
  positions: { user_id: string; side: BetSide | null; option_id: string }[];
  /** Ordered by `position`. Always at least two. */
  options: BetOptionRow[];
  media?: BetMedia[];
  group?: Pick<GroupRow, 'id' | 'name' | 'emoji' | 'avatar_url'>;
}
