import { useCallback, useMemo, useRef, useState } from 'react';

import { useAsync } from '@/hooks/use-async';
import type { BetComment } from '@/lib/database.types';
import { deleteBetComment, fetchBetComments, postBetComment } from '@/lib/queries';

/** Long enough for a real argument, short enough not to become a blog post. */
export const COMMENT_MAX_LENGTH = 500;

/** The id prefix a comment carries while it is only real on this device. */
const PENDING_PREFIX = 'pending-';

/** Whether this row is an optimistic one the server has not confirmed yet. */
export function isPendingComment(comment: BetComment): boolean {
  return comment.id.startsWith(PENDING_PREFIX);
}

export interface BetCommentThread {
  /** Server rows plus anything sent from this device and not yet confirmed. */
  rows: BetComment[];
  total: number;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  canSend: boolean;
  send: () => Promise<void>;
  remove: (commentId: string) => Promise<void>;
}

/**
 * The comment thread's state, independent of where it is drawn.
 *
 * The same thread now appears in two places — inline under the bet, and in the
 * sheet that rises over the feed — and they have to behave identically, because
 * they are the same conversation. Keeping fetch, optimistic post and delete
 * here is what stops the two surfaces drifting into two slightly different sets
 * of rules about when your own sentence appears.
 *
 * Posting is **optimistic**. The comment appears the instant you send it,
 * greyed until the write lands, and is removed with the error surfaced if it
 * fails — and the words are handed back to the box, because retyping a sentence
 * is a worse outcome than tapping send twice.
 */
export function useBetCommentThread({
  betId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  onTotalChange,
}: {
  betId: string;
  currentUserId: string;
  currentUserName?: string | null;
  currentUserAvatar?: string | null;
  /**
   * The confirmed server count after a post or delete. The feed uses it to
   * patch the card's "View all N comments" line rather than re-reading a
   * hundred bets to move one number.
   */
  onTotalChange?: (total: number) => void;
}): BetCommentThread {
  const comments = useAsync(() => fetchBetComments(betId), [betId]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Comments written on this device that the server has not confirmed yet. */
  const [pending, setPending] = useState<BetComment[]>([]);

  // Read through a ref so a caller writing this as an inline arrow — which the
  // feed does — cannot retrigger anything by changing its identity.
  const notify = useRef(onTotalChange);
  notify.current = onTotalChange;

  const rows = useMemo(() => {
    const server = comments.data ?? [];
    const serverIds = new Set(server.map((row) => row.id));
    // A pending comment disappears the moment the real one arrives under the
    // same id, so the send never double-renders on a slow connection.
    return [...server, ...pending.filter((row) => !serverIds.has(row.id))];
  }, [comments.data, pending]);

  const clearError = useCallback(() => setError(null), []);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;

    // A local id, replaced wholesale when the thread reloads.
    const optimistic: BetComment = {
      id: `${PENDING_PREFIX}${Date.now()}`,
      bet_id: betId,
      user_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      author: {
        display_name: currentUserName ?? 'You',
        avatar_url: currentUserAvatar ?? null,
      },
    } as BetComment;

    setSending(true);
    setError(null);
    setDraft('');
    setPending((current) => [...current, optimistic]);

    try {
      await postBetComment(betId, currentUserId, body);
      const fresh = await fetchBetComments(betId);
      setPending((current) => current.filter((row) => row.id !== optimistic.id));
      comments.setData(fresh);
      notify.current?.(fresh.length);
    } catch (err) {
      // Take the ghost back out and hand the words back, so a failed send on a
      // bad connection costs a tap rather than the sentence.
      setPending((current) => current.filter((row) => row.id !== optimistic.id));
      setDraft(body);
      setError(err instanceof Error ? err.message : 'Could not post that.');
    } finally {
      setSending(false);
    }
    // `comments.setData` is stable; the object around it is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betId, currentUserAvatar, currentUserId, currentUserName, draft, sending, comments.setData]);

  const remove = useCallback(
    async (commentId: string) => {
      try {
        await deleteBetComment(commentId);
        const fresh = await fetchBetComments(betId);
        comments.setData(fresh);
        notify.current?.(fresh.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete that.');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [betId, comments.setData]
  );

  return {
    rows,
    total: rows.length,
    loading: comments.loading,
    error,
    clearError,
    draft,
    setDraft,
    sending,
    canSend: draft.trim().length > 0 && !sending,
    send,
    remove,
  };
}
