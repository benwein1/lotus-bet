import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  Layout,
  SlideInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from '@/components/animated';

import { CloseIcon, CommentIcon, SendIcon } from '@/components/icons';
import {
  Avatar,
  ErrorNotice,
  PressableScale,
  Skeleton,
  tap,
  useConfirm,
} from '@/components/ui';
import {
  COMMENT_MAX_LENGTH,
  isPendingComment,
  useBetCommentThread,
  type BetCommentThread,
} from '@/hooks/use-bet-comments';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetComment } from '@/lib/database.types';
import { formatRelativeShort } from '@/lib/format';
import { useColors } from '@/providers/theme-provider';
import { elevation, motion } from '@/theme';

/**
 * How many comments show before the thread asks to be opened.
 *
 * Three is the number every social app converged on, and for the same reason:
 * it is enough to see that a conversation is happening and whose it is, and
 * few enough that the thing the comments are *about* stays on screen.
 */
const PREVIEW_COUNT = 3;

/** Who is doing the commenting — the same four values wherever the thread is drawn. */
interface Commenter {
  currentUserId: string;
  currentUserName?: string | null;
  currentUserAvatar?: string | null;
}

/**
 * Opens the report/block sheet for somebody else's comment.
 *
 * Passed down rather than owned here so one sheet serves the whole screen —
 * the same reason the feed mounts one comments sheet rather than one per card.
 */
type ReportComment = (comment: BetComment) => void;

/**
 * The comment thread under a bet, inline on the bet screen.
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
 */
export function BetComments({
  betId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  onReportComment,
}: { betId: string; onReportComment?: ReportComment } & Commenter) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const { ask, dialog } = useConfirm();
  const inputRef = useRef<TextInput>(null);

  const thread = useBetCommentThread({
    betId,
    currentUserId,
    currentUserName,
    currentUserAvatar,
  });

  // Collapsed until the count is pressed. Unlike the sheet — which exists to
  // show the whole conversation — this thread sits under the bet it is about,
  // and that bet has to stay on screen.
  const [expanded, setExpanded] = useState(false);
  const total = thread.total;
  const hidden = Math.max(0, total - PREVIEW_COUNT);
  const shown = expanded ? thread.rows : thread.rows.slice(-PREVIEW_COUNT);

  return (
    <View className="mt-7">
      <Text className="mb-3 text-lg font-semibold text-primary">
        {total === 0 ? 'Comments' : total === 1 ? '1 comment' : `${total} comments`}
      </Text>

      {thread.error && (
        <View className="mb-3">
          <ErrorNotice message={thread.error} />
        </View>
      )}

      {thread.loading ? (
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
          {hidden > 0 && !expanded && (
            <PressableScale
              scaleTo={1}
              onPress={() => setExpanded(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`View all ${total} comments`}
              className="mb-3 self-start py-1"
            >
              <Text className="text-subhead text-secondary">View all {total} comments</Text>
            </PressableScale>
          )}

          <View className="gap-3.5">
            {shown.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                mine={comment.user_id === currentUserId}
                reduced={reduced}
                onDelete={() => askDelete(ask, () => void thread.remove(comment.id))}
                onReport={onReportComment ? () => onReportComment(comment) : undefined}
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
      <View className="mt-5">
        <Composer
          thread={thread}
          inputRef={inputRef}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserAvatar={currentUserAvatar}
          onSent={() => setExpanded(true)}
        />
      </View>

      {dialog}
    </View>
  );
}

/**
 * The same thread, risen over the feed instead of replacing it.
 *
 * Pressing "Add a comment" on a feed card used to push the whole bet screen,
 * which is the wrong trade: you lose the photo you were looking at, the feed's
 * scroll position, and the video that was playing, to read three sentences. A
 * sheet keeps the bet exactly where it was and puts the conversation under it —
 * the shape every feed people already use has converged on.
 *
 * One of these is mounted by the feed and pointed at whichever bet is open.
 * Not one per card: a `FlatList` keeps several cards mounted, and a modal per
 * card is several modals stacked on the same screen.
 */
export function BetCommentsSheet({
  betId,
  onClose,
  onTotalChange,
  onReportComment,
  currentUserId,
  currentUserName,
  currentUserAvatar,
}: {
  /** The bet whose thread is open, or null when the sheet is closed. */
  betId: string | null;
  onClose: () => void;
  /**
   * The confirmed comment count after a post or delete, so the card underneath
   * can patch its own line rather than the feed re-reading every bet.
   */
  onTotalChange?: (betId: string, total: number) => void;
  onReportComment?: ReportComment;
} & Commenter) {
  return (
    <Modal
      visible={betId !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Keyed on the bet, and only mounted while open: the thread's fetch and
          its optimistic state belong to one bet and should not survive the
          sheet being pointed at another. */}
      {betId !== null && (
        <SheetBody
          key={betId}
          betId={betId}
          onClose={onClose}
          onTotalChange={onTotalChange}
          onReportComment={onReportComment}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserAvatar={currentUserAvatar}
        />
      )}
    </Modal>
  );
}

function SheetBody({
  betId,
  onClose,
  onTotalChange,
  onReportComment,
  currentUserId,
  currentUserName,
  currentUserAvatar,
}: {
  betId: string;
  onClose: () => void;
  onTotalChange?: (betId: string, total: number) => void;
  onReportComment?: ReportComment;
} & Commenter) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const { height } = useWindowDimensions();
  const { ask, dialog } = useConfirm();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const thread = useBetCommentThread({
    betId,
    currentUserId,
    currentUserName,
    currentUserAvatar,
    onTotalChange: (total) => onTotalChange?.(betId, total),
  });

  // Most of the screen, deliberately not all of it. The strip of feed left
  // showing above is what makes this read as a layer over the bet rather than
  // as the other screen this is meant to replace.
  const sheetHeight = Math.max(360, Math.round(height * 0.74));

  // Newest sits at the bottom, as it does inline, so the thread has to open on
  // the end of the conversation and stay there as it grows.
  const total = thread.total;
  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(id);
  }, [total]);

  // Dragging the grabber down closes it — the gesture the platform has trained
  // everyone to try first. It is bound to the header only, so it can never
  // fight the thread's own scroll.
  const dragY = useSharedValue(0);
  const drag = Gesture.Pan()
    .onUpdate((event) => {
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (dragY.value > 110 || event.velocityY > 900) {
        dragY.value = 0;
        runOnJS(onClose)();
      } else {
        dragY.value = withSpring(0, motion.press);
      }
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <View className="flex-1 justify-end bg-scrim">
        {/* The dismiss target is a *sibling* above the sheet, not an absolutely
            positioned overlay. On the web a positioned overlay paints above its
            unpositioned siblings and swallows presses meant for the card — the
            trap already written down against the confirm dialog. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close comments"
          style={{ flex: 1 }}
        />

        <Animated.View
          entering={
            reduced
              ? FadeIn.duration(motion.duration.fast)
              : SlideInDown.springify().damping(22).stiffness(190)
          }
          style={[
            { height: sheetHeight, flexShrink: 1, maxHeight: '100%' },
            elevation.floating,
            dragStyle,
          ]}
          className="overflow-hidden rounded-t-4xl border-t border-hairline-strong bg-canvas"
        >
          <GestureDetector gesture={drag}>
            <View className="px-gutter pb-3 pt-2.5">
              <View className="mb-3 h-1 w-9 self-center rounded-full bg-hairline-strong" />
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-semibold text-primary">
                  {total === 0 ? 'Comments' : total === 1 ? '1 comment' : `${total} comments`}
                </Text>
                <PressableScale
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close comments"
                  className="h-8 w-8 items-center justify-center rounded-full bg-surface3"
                >
                  <CloseIcon size={16} color={colors.textSecondary} />
                </PressableScale>
              </View>
            </View>
          </GestureDetector>

          <View className="h-px bg-hairline" />

          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName="px-gutter py-4 gap-3.5"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {thread.error && <ErrorNotice message={thread.error} />}

            {thread.loading ? (
              <>
                <CommentSkeleton />
                <CommentSkeleton />
                <CommentSkeleton />
              </>
            ) : total === 0 ? (
              <PressableScale
                scaleTo={0.99}
                onPress={() => inputRef.current?.focus()}
                accessibilityRole="button"
                accessibilityLabel="Be the first to comment"
                className="mt-6 items-center gap-2 px-6 py-7"
              >
                <CommentIcon size={26} color={colors.textTertiary} />
                <Text className="text-center text-base font-semibold text-primary">
                  No comments yet
                </Text>
                <Text className="text-center text-sm text-secondary">
                  First word is worth something.
                </Text>
              </PressableScale>
            ) : (
              thread.rows.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  mine={comment.user_id === currentUserId}
                  reduced={reduced}
                  onDelete={() => askDelete(ask, () => void thread.remove(comment.id))}
                  onReport={onReportComment ? () => onReportComment(comment) : undefined}
                />
              ))
            )}
          </ScrollView>

          {/* Pinned, unlike the inline thread: in a sheet the composer *is* the
              bottom edge, and the safe-area inset is what keeps it off the home
              indicator. `edges` is bottom-only — the top of this sheet is
              nowhere near the notch. */}
          <SafeAreaView edges={['bottom']} className="border-t border-hairline bg-canvas">
            <View className="px-gutter py-2.5">
              <Composer
                thread={thread}
                inputRef={inputRef}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentUserAvatar={currentUserAvatar}
                keepKeyboard
              />
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>

      {dialog}
    </KeyboardAvoidingView>
  );
}

/**
 * The box you type into, identical in both places.
 *
 * A round send button rather than a word: it is the same control every
 * messaging app puts here, and it stays out of the way until there is
 * something to send.
 */
function Composer({
  thread,
  inputRef,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  onSent,
  keepKeyboard = false,
}: {
  thread: BetCommentThread;
  inputRef: React.RefObject<TextInput | null>;
  onSent?: () => void;
  /**
   * True in the sheet: the conversation stays open in front of you, so taking
   * the keyboard away after every sentence would be the app deciding you were
   * finished.
   */
  keepKeyboard?: boolean;
} & Commenter) {
  const colors = useColors();

  return (
    <View className="flex-row items-end gap-2">
      <Avatar
        id={currentUserId}
        name={currentUserName ?? 'You'}
        uri={currentUserAvatar ?? null}
        size={32}
      />

      <View className="flex-1 flex-row items-end gap-2 rounded-[22px] border border-hairline bg-surface py-1.5 pl-4 pr-1.5">
        <TextInput
          ref={inputRef}
          value={thread.draft}
          onChangeText={thread.setDraft}
          placeholder="Add a comment"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={COMMENT_MAX_LENGTH}
          editable={!thread.sending}
          accessibilityLabel="Add a comment"
          className="max-h-24 flex-1 py-2 text-base"
          // `flex-1` alone sets a zero basis but leaves `min-width: auto`, so
          // on the web the input keeps its intrinsic width and refuses to
          // shrink — see the PaymentSheet note in CLAUDE.md §4.
          style={{ color: colors.text, minWidth: 0 }}
        />

        <PressableScale
          onPress={() => {
            tap();
            onSent?.();
            void thread.send();
            if (!keepKeyboard) inputRef.current?.blur();
          }}
          disabled={!thread.canSend}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled: !thread.canSend }}
          className={`h-9 w-9 items-center justify-center rounded-full ${
            thread.canSend ? 'bg-accent' : 'bg-surface3'
          }`}
        >
          <SendIcon
            size={17}
            color={thread.canSend ? colors.accentInk : colors.textTertiary}
          />
        </PressableScale>
      </View>
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
  reduced,
  onDelete,
  onReport,
}: {
  comment: BetComment;
  mine: boolean;
  reduced: boolean;
  onDelete: () => void;
  /** Long-press on somebody else's comment. Absent on a screen without a sheet. */
  onReport?: () => void;
}) {
  const name = comment.author?.display_name ?? 'Someone';
  const age = formatRelativeShort(comment.created_at);
  const pendingWrite = isPendingComment(comment);

  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(180)}
      layout={reduced ? undefined : Layout.springify().damping(20)}
      className={pendingWrite ? 'opacity-55' : ''}
    >
      {/* One gesture, two meanings, because they are the same intention from
          opposite sides: long-press your own comment to take it back, long-press
          somebody else's to report it. Guideline 1.2 asks for a way to report
          content, and a menu nobody can find does not count — this is where a
          hand already goes. */}
      <PressableScale
        scaleTo={mine || onReport ? 0.99 : 1}
        disabled={pendingWrite || (!mine && !onReport)}
        onLongPress={mine ? onDelete : onReport}
        accessibilityRole={mine || onReport ? 'button' : 'text'}
        // The whole comment reads as one sentence to a screen reader, because
        // that is what it is — the name is not a separate element to land on.
        accessibilityLabel={`${name}: ${comment.body}. ${age}`}
        accessibilityHint={
          pendingWrite
            ? undefined
            : mine
              ? 'Press and hold to delete'
              : onReport
                ? 'Press and hold to report or block'
                : undefined
        }
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
          <Text className="mt-1 text-2xs text-tertiary">{pendingWrite ? 'Sending' : age}</Text>
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

/** A comment can be withdrawn but never edited — so the prompt is final. */
function askDelete(ask: ReturnType<typeof useConfirm>['ask'], onConfirm: () => void) {
  ask({
    title: 'Delete comment?',
    message: 'It disappears for everyone in the group.',
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm,
  });
}
