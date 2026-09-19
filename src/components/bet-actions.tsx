import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from '@/components/animated';

import { CommentIcon, HeartIcon } from '@/components/icons';
import { PressableScale, tap } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useColors } from '@/providers/theme-provider';
import { motion, tabular } from '@/theme';

/**
 * The like and comment row — the one place in the app that behaves like a
 * social feed rather than a ledger.
 *
 * Liking is **optimistic**. The heart fills on press-in and the count moves
 * with it, before anything has reached the server; `onToggle` gets the state
 * the user asked for and the row rolls itself back if that write fails. A
 * social control that waits a round trip to acknowledge a tap feels broken in
 * a way that a slow one does not, and the cost of being briefly wrong about a
 * like is nothing.
 */
export function BetActions({
  liked,
  likeCount,
  commentCount,
  onToggleLike,
  onPressComments,
  onMedia = false,
  size = 'md',
  showCommentCount = true,
}: {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onToggleLike: (next: boolean) => Promise<void> | void;
  /**
   * Omit on a screen that already shows the thread. The button is dropped
   * rather than left inert — the count is in the section heading there, and a
   * control that does nothing when pressed is worse than no control.
   */
  onPressComments?: () => void;
  /** Over a photo or video, where the palette has to ignore the scheme. */
  onMedia?: boolean;
  size?: 'sm' | 'md';
  /**
   * False where a "View all N comments" line sits underneath and already
   * carries the number. Printing it twice in the same corner reads as a bug.
   */
  showCommentCount?: boolean;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();

  // Local truth while a write is in flight, so the finger is never waiting.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? liked;

  // A prop change that agrees with us (our own write landing, or realtime
  // reporting it) retires the optimistic value rather than fighting it.
  useEffect(() => {
    if (optimistic !== null && optimistic === liked) setOptimistic(null);
  }, [liked, optimistic]);

  const delta = optimistic === null || optimistic === liked ? 0 : optimistic ? 1 : -1;
  const count = Math.max(0, likeCount + delta);

  const pop = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const iconSize = size === 'sm' ? 20 : 24;
  const label = onMedia ? 'text-on-media-soft' : 'text-secondary';
  const restingColor = onMedia ? colors.onMediaSoft : colors.textSecondary;

  async function toggle() {
    const next = !shown;
    setOptimistic(next);
    tap();

    // Only the fill gets the overshoot, and only on the way on. A heart that
    // bounces when you *unlike* something is celebrating the wrong thing.
    if (!reduced && next) {
      pop.value = withSequence(
        withSpring(0.8, { duration: 120, dampingRatio: 1 }),
        withSpring(1, motion.celebrate)
      );
    }

    try {
      await onToggleLike(next);
    } catch {
      // Put it back. The row is the only place that knew, so nothing else
      // needs telling.
      setOptimistic(null);
    }
  }

  return (
    <View className="flex-row items-center gap-5">
      <PressableScale
        onPress={() => void toggle()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ selected: shown }}
        accessibilityLabel={shown ? 'Unlike this bet' : 'Like this bet'}
        className="flex-row items-center gap-1.5"
      >
        <Animated.View style={heartStyle}>
          <HeartIcon
            size={iconSize}
            active={shown}
            color={shown ? colors.accent : restingColor}
          />
        </Animated.View>
        {count > 0 ? (
          <Text style={tabular} className={`text-sm ${shown ? 'text-accent' : label}`}>
            {count}
          </Text>
        ) : null}
      </PressableScale>

      {onPressComments && (
        <PressableScale
          onPress={onPressComments}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={commentCount === 1 ? '1 comment' : `${commentCount} comments`}
          className="flex-row items-center gap-1.5"
        >
          <CommentIcon size={iconSize} color={restingColor} />
          {showCommentCount && commentCount > 0 ? (
            <Text style={tabular} className={`text-sm ${label}`}>
              {commentCount}
            </Text>
          ) : null}
        </PressableScale>
      )}
    </View>
  );
}

/** Pull the two counts and "did I like it" out of an embedded bet row. */
export function betSocial(
  bet: { likes?: { user_id: string }[]; comments?: { count: number }[] },
  userId: string
): { liked: boolean; likeCount: number; commentCount: number } {
  const likes = bet.likes ?? [];
  return {
    liked: likes.some((l) => l.user_id === userId),
    likeCount: likes.length,
    // PostgREST returns an aggregate embed as a one-row array.
    commentCount: bet.comments?.[0]?.count ?? 0,
  };
}
