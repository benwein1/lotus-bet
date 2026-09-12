import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { CommentIcon } from '@/components/icons';
import {
  Avatar,
  ErrorNotice,
  PressableScale,
  SectionTitle,
  Skeleton,
  useConfirm,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatShortDate } from '@/lib/format';
import { deleteBetComment, fetchBetComments, postBetComment } from '@/lib/queries';
import { useColors } from '@/providers/theme-provider';

/**
 * The comment thread under a bet.
 *
 * Deliberately plain: no threading, no replies, no reactions on a reaction. A
 * bet is settled by its own rules, and the comments are the trash talk around
 * it — the moment they become a place to argue about the result, the result
 * stops being the ledger's job.
 *
 * Posting clears the box first and reloads the thread after, so the send
 * always feels done even when the round trip is not. A failed post surfaces as
 * an error above the thread rather than restoring the draft: the text is short
 * and retyping it is cheaper than wondering whether it went.
 */
export function BetComments({
  betId,
  currentUserId,
}: {
  betId: string;
  currentUserId: string;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const { ask, dialog } = useConfirm();

  const comments = useAsync(() => fetchBetComments(betId), [betId]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = comments.data ?? [];

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      await postBetComment(betId, currentUserId, body);
      setDraft('');
      await comments.reload({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that.');
    } finally {
      setSending(false);
    }
  }

  function confirmDelete(commentId: string) {
    ask({
      title: 'Delete comment?',
      message: 'It disappears for everyone in the group.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteBetComment(commentId);
            await comments.reload({ silent: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete that.');
          }
        })();
      },
    });
  }

  return (
    <View className="mt-7">
      <SectionTitle>
        {rows.length === 0
          ? 'Comments'
          : rows.length === 1
            ? '1 comment'
            : `${rows.length} comments`}
      </SectionTitle>

      {error && <ErrorNotice message={error} />}

      <View className="rounded-3xl border border-hairline bg-surface">
        {comments.loading ? (
          <View className="gap-3 p-4">
            <Skeleton className="h-4 w-1/3 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
          </View>
        ) : rows.length === 0 ? (
          <View className="items-center gap-2 px-6 py-8">
            <CommentIcon size={22} color={colors.textTertiary} />
            <Text className="text-center text-sm text-secondary">
              Nothing said yet. First word is worth something.
            </Text>
          </View>
        ) : (
          <View className="px-4 py-1">
            {rows.map((comment, index) => (
              <Animated.View
                key={comment.id}
                entering={reduced ? undefined : FadeIn.delay(Math.min(index, 6) * 30)}
              >
                <PressableScale
                  scaleTo={1}
                  disabled={comment.user_id !== currentUserId}
                  onLongPress={() => confirmDelete(comment.id)}
                  accessibilityRole={comment.user_id === currentUserId ? 'button' : 'text'}
                  accessibilityHint={
                    comment.user_id === currentUserId
                      ? 'Press and hold to delete your comment'
                      : undefined
                  }
                  className="flex-row gap-3 py-3"
                >
                  <Avatar
                    id={comment.user_id}
                    name={comment.author?.display_name ?? 'Someone'}
                    uri={comment.author?.avatar_url ?? null}
                    size={30}
                  />
                  <View className="flex-1">
                    <View className="flex-row items-baseline gap-2">
                      <Text
                        numberOfLines={1}
                        className="flex-1 text-sm font-semibold text-primary"
                      >
                        {comment.author?.display_name ?? 'Someone'}
                      </Text>
                      <Text className="text-2xs text-tertiary">
                        {formatShortDate(comment.created_at)}
                      </Text>
                    </View>
                    <Text className="mt-0.5 text-subhead leading-5 text-primary">
                      {comment.body}
                    </Text>
                  </View>
                </PressableScale>
              </Animated.View>
            ))}
          </View>
        )}
      </View>

      {/* The send box is its own surface below the thread rather than pinned to
          the keyboard: this screen is a scroll, not a chat, and a floating bar
          would cover the bet it is about. */}
      <View className="mt-3 flex-row items-end gap-2">
        <View className="flex-1 rounded-2xl border border-hairline bg-surface px-4 py-2.5">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={500}
            editable={!sending}
            onSubmitEditing={() => void send()}
            accessibilityLabel="Add a comment"
            className="max-h-24 text-base text-primary"
            style={{ color: colors.text }}
          />
        </View>
        <PressableScale
          onPress={() => void send()}
          disabled={sending || draft.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          className={`h-11 justify-center rounded-2xl px-4 ${
            draft.trim().length === 0 ? 'bg-surface3' : 'bg-accent'
          }`}
        >
          <Text
            className={`text-callout font-semibold ${
              draft.trim().length === 0 ? 'text-tertiary' : 'text-accent-ink'
            }`}
          >
            Post
          </Text>
        </PressableScale>
      </View>

      {dialog}
    </View>
  );
}
