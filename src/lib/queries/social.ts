/**
 * Likes and comments — the reactions that hang off a bet.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  BetComment,
} from '../database.types';
import { prepareContent } from '../content-rules';
import { supabase } from '../supabase';

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

  const { error } = liked
    ? await supabase
        .from('bet_likes')
        .upsert({ bet_id: betId, user_id: userId }, { onConflict: 'bet_id,user_id' })
    : await supabase.from('bet_likes').delete().eq('bet_id', betId).eq('user_id', userId);

  if (error) throw new Error(error.message);
}

export async function fetchBetComments(betId: string): Promise<BetComment[]> {

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
  const checked = prepareContent(body);
  if (!checked.ok) throw new Error(checked.message);


  const { data, error } = await supabase
    .from('bet_comments')
    .insert({ bet_id: betId, user_id: userId, body: checked.text })
    .select('*, author:users(id, display_name, avatar_url)')
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as BetComment;
}

export async function deleteBetComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('bet_comments').delete().eq('id', commentId);
  if (error) throw new Error(error.message);
}

