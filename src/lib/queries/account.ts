/**
 * The account itself: the 16+ confirmation, reporting, blocking, and deletion.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  BlockedUser,
  ReportReason,
  ReportTargetKind,
} from '../database.types';
import { supabase } from '../supabase';


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
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_user_id: userId });
  if (error) throw new Error(error.message);
}

/** Everyone you have blocked, so Profile can offer to undo it. */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
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
export async function blockedIds(): Promise<Set<string>> {
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
  const { error } = await supabase.rpc('delete_account');
  if (error) throw new Error(error.message);
}
