/**
 * Looking somebody up, and the two-person group a challenge creates.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  GroupRow,
  UserLookup,
} from '../database.types';
import { demo, isDemoMode } from '../demo';
import { supabase } from '../supabase';

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

