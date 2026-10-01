/**
 * Groups: the rooms bets live in, and the two ways into one.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  GroupInviteRow,
  GroupMemberRow,
  GroupRow,
  UserRow,
} from '../database.types';
import { demo, isDemoMode } from '../demo';
import { DEFAULT_CURRENCY, type Currency } from '../currency';
import { announceGroupJoin } from '../notifications';
import { prepareContent } from '../content-rules';
import { isMissingColumn } from '../postgrest';
import { supabase } from '../supabase';
import { unwrap, USER_PUBLIC_COLUMNS, groupColumns } from './core';

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

