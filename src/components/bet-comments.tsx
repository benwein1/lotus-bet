import { useMemo, useRef, useState } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, Layout } from '@/components/animated';

import { CommentIcon, SendIcon } from '@/components/icons';
import {
  Avatar,
  ErrorNotice,
  PressableScale,
  Skeleton,
  tap,
  useConfirm,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetComment } from '@/lib/database.types';
import { formatRelativeShort } from '@/lib/format';
import { deleteBetComment, fetchBetComments, postBetComment } from '@/lib/queries';
import { useColors } from '@/providers/theme-provider';

/**
 * How many comments show before the thread asks to be opened.
 *
 * Three is the number every social app converged on, and for the same reason:
 * it is enough to see that a conversation is happening and whose it is, and
 * few enough that the thing the comments are *about* stays on screen.
 */
const PREVIEW_COUNT = 3;

/** Long enough for a real argument, short enough not to become a blog post. */
const MAX_LENGTH = 500;

/**
 * The comment thread under a bet.
 *
 * Shaped like the threads people already know — avatar, name and body on one
 * flowing paragraph, a quiet relative timestamp underneath, newest at the
 * bottom, a composer that stays put. The familiarity is the point: nobody
 * should have to learn how to argue with their friends.
 *
 * Deliberately still plain underneath: no threading, no replies, no reactions
 * on a reaction. A bet is settled by its own rules, and the comments are the
 * trash talk around it — the moment they become a place to argue about the
 * result, the result stops being the ledger's job.
 *
 * Posting is **optimistic**. The comment appears the instant you send it,
 * greyed until the write lands, and is removed with the error surfaced if it
 * fails. A thread that waits a round trip before showing your own sentence
 * feels broken in the same way a like that waits does.
 */
export function BetComments({
  betId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
}: {
  betId: string;
  currentUserId: string;
  currentUserName?: string | null;
  currentUserAvatar?: string | null;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const { ask, dialog } = useConfirm();
  const inputRef = useRef<TextInput>(null);

  const comments = useAsync(() => fetchBetComments(betId), [betId]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Comments written on this device that the server has not confirmed yet. */
  const [pending, setPending] = useState<BetComment[]>([]);

  const { reload: reloadComments } = comments;

  const rows = useMemo(() => {
    const server = comments.data ?? [];
    const serverIds = new Set(server.map((row) => row.id));
    // A pending comment disappears the moment the real one arrives under the
    // same id, so the send never double-renders on a slow connection.
    return [...server, ...pending.filter((row) => !serverIds.has(row.id))];
  }, [comments.data, pending]);

  const total = rows.length;
  const hidden = Math.max(0, total - PREVIEW_COUNT);
  const shown = expanded ? rows : rows.slice(-PREVIEW_COUNT);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    // A local id, replaced wholesale when the thread reloads.
    const optimistic: BetComment = {
      id: `pending-${Date.now()}`,
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
    setExpanded(true);
    tap();

    try {
      await postBetComment(betId, currentUserId, body);
      await reloadComments({ silent: true });
      setPending((current) => current.filter((row) => row.id !== optimistic.id));
    } catch (err) {
      // Take the ghost back out and hand the words back, so a failed send on a
      // bad connection costs a tap rather than the sentence.
      setPending((current) => current.filter((row) => row.id !== optimistic.id));
      setDraft(body);
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
            await reloadComments({ silent: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete that.');
          }
        })();
      },
    });
  }

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <View className="mt-7">
      <Text className="mb-3 text-lg font-semibold text-primary">
        {total === 0 ? 'Comments' : total === 1 ? '1 comment' : `${total} comments`}
      </Text>

      {error && (
        <View className="mb-3">
          <ErrorNotice message={error} />
        </View>
      )}

      {comments.loading ? (
        <View className="gap-4 py-1">
          <CommentSkeleton />
          <CommentSkeleton />
        </View>
      ) : total === 0 ? (
        <PressableScale
          scaleTo={0.99}
          onPress={() => inputRef.current?.focus()}
          accessibilityRole="button"
          accessibilityLabel="Be the first to comment"
          className="items-center gap-2 rounded-3xl border border-hairline bg-surface px-6 py-7"
        >
          <CommentIcon size={22} color={colors.textTertiary} />
          <Text className="text-center text-sm text-secondary">
            Nothing said yet. First word is worth something.
          </Text>
        </PressableScale>
      ) : (
        <View>
          {/* Instagram's affordance, and for Instagram's reason: the thread is
              collapsed by default so the bet it is about stays on screen, and
              the count is the thing you press to see the rest. */}
          {hidden > 0 && !expanded && (
            <PressableScale
              scaleTo={1}
              onPress={() => setExpanded(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`View all ${total} comments`}
              className="mb-3 self-start py-1"
            >
              <Text className="text-subhead text-secondary">
                View all {total} comments
              </Text>
            </PressableScale>
          )}

          <View className="gap-3.5">
            {shown.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                mine={comment.user_id === currentUserId}
                pendingWrite={comment.id.startsWith('pending-')}
                reduced={reduced}
                onDelete={() => confirmDelete(comment.id)}
              />
            ))}
          </View>

          {expanded && hidden > 0 && (
            <PressableScale
              scaleTo={1}
              onPress={() => setExpanded(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Show fewer comments"
              className="mt-3 self-start py-1"
            >
              <Text className="text-subhead text-secondary">Show fewer</Text>
            </PressableScale>
          )}
        </View>
      )}

      {/* The composer sits under the thread rather than pinned to the keyboard:
          this screen is a scroll, not a chat, and a floating bar would cover
          the bet the comments are about. The screen's KeyboardAvoidingView is
          what keeps it visible while typing. */}
      <View className="mt-5 flex-row items-end gap-2">
        <Avatar
          id={currentUserId}
          name={currentUserName ?? 'You'}
          uri={currentUserAvatar ?? null}
          size={32}
        />

        <View className="flex-1 flex-row items-end gap-2 rounded-[22px] border border-hairline bg-surface py-1.5 pl-4 pr-1.5">
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={MAX_LENGTH}
            editable={!sending}
            accessibilityLabel="Add a comment"
            className="max-h-24 flex-1 py-2 text-base"
            // `flex-1` alone sets a zero basis but leaves `min-width: auto`, so
            // on the web the input keeps its intrinsic width and refuses to
            // shrink — see the PaymentSheet note in CLAUDE.md §4.
            style={{ color: colors.text, minWidth: 0 }}
          />

          {/* A round send button rather than a word: it is the same control
              every messaging app puts here, and it stays out of the way until
              there is something to send. */}
          <PressableScale
            onPress={() => {
              void send();
              Keyboard.dismiss();
            }}
            disabled={!canSend}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            accessibilityState={{ disabled: !canSend }}
            className={`h-9 w-9 items-center justify-center rounded-full ${
              canSend ? 'bg-accent' : 'bg-surface3'
            }`}
          >
            <SendIcon size={17} color={canSend ? colors.accentInk : colors.textTertiary} />
          </PressableScale>
        </View>
      </View>

      {dialog}
    </View>
  );
}

/**
 * One comment.
 *
 * Name and body share a single flowing paragraph rather than sitting in two
 * stacked blocks — it is how a spoken remark reads, it wraps naturally at any
 * length, and it costs a line less per comment, which is most of why a thread
 * of ten still fits under the bet.
 */
function CommentRow({
  comment,
  mine,
  pendingWrite,
  reduced,
  onDelete,
}: {
  comment: BetComment;
  mine: boolean;
  /** Written on this device, not yet acknowledged by the server. */
  pendingWrite: boolean;
  reduced: boolean;
  onDelete: () => void;
}) {
  const name = comment.author?.display_name ?? 'Someone';
  const age = formatRelativeShort(comment.created_at);

  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(180)}
      layout={reduced ? undefined : Layout.springify().damping(20)}
      className={pendingWrite ? 'opacity-55' : ''}
    >
      <PressableScale
        scaleTo={mine ? 0.99 : 1}
        disabled={!mine || pendingWrite}
        onLongPress={onDelete}
        accessibilityRole={mine ? 'button' : 'text'}
        // The whole comment reads as one sentence to a screen reader, because
        // that is what it is — the name is not a separate element to land on.
        accessibilityLabel={`${name}: ${comment.body}. ${age}`}
        accessibilityHint={mine && !pendingWrite ? 'Press and hold to delete' : undefined}
        className="flex-row gap-3"
      >
        <Avatar
          id={comment.user_id}
          name={name}
          uri={comment.author?.avatar_url ?? null}
          size={32}
        />

        <View className="flex-1">
          <Text className="text-subhead leading-5 text-primary">
            <Text className="font-semibold">{name}</Text>
            <Text>{'  '}</Text>
            <Text>{comment.body}</Text>
          </Text>
          <Text className="mt-1 text-2xs text-tertiary">
            {pendingWrite ? 'Sending' : age}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function CommentSkeleton() {
  return (
    <View className="flex-row gap-3">
      <Skeleton className="h-8 w-8 rounded-full" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-3.5 w-2/3 rounded-md" />
        <Skeleton className="h-3 w-1/4 rounded-md" />
      </View>
    </View>
  );
}
