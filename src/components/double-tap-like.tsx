import { useCallback, useRef } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from '@/components/animated';

import { HeartIcon } from '@/components/icons';
import { tap } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { motion } from '@/theme';

/** How long a second tap has to arrive to count as a double tap. */
const WINDOW_MS = 280;

/**
 * Double-tap a photo to like it, with the heart that flies over it.
 *
 * Wrap it around media whose **single** tap does nothing. That constraint is
 * the whole design note: a double-tap detector has to hold the first tap for
 * ~280ms to find out whether a second one is coming, so putting this on
 * anything that navigates would add a quarter-second of dead air to every
 * press. On the feed card, where one tap opens the bet, that trade is plainly
 * the wrong way round — which is why this is only on the bet screen's hero.
 *
 * Because nothing competes for the single tap here, there is no timer at all:
 * the first tap is simply remembered, and the second one inside the window
 * fires. A single tap costs nothing and does nothing.
 */
export function DoubleTapToLike({
  children,
  onLike,
  enabled = true,
}: {
  children: React.ReactNode;
  onLike: () => void;
  /** False once it is already liked — the gesture never un-likes. */
  enabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const lastTap = useRef(0);

  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  const burst = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const onPress = useCallback(() => {
    const now = Date.now();
    const isDouble = now - lastTap.current < WINDOW_MS;
    lastTap.current = isDouble ? 0 : now;
    if (!isDouble || !enabled) return;

    tap();

    if (reduced) {
      // Still show it, still land it — just without the travel.
      opacity.value = withSequence(withTiming(1, { duration: 90 }), withDelay(320, withTiming(0, { duration: 160 })));
      scale.value = 1;
    } else {
      scale.value = 0.4;
      scale.value = withSequence(
        withSpring(1.05, motion.celebrate),
        withDelay(260, withTiming(0.85, { duration: 180 }))
      );
      opacity.value = withSequence(
        withTiming(1, { duration: 90 }),
        withDelay(280, withTiming(0, { duration: 200 }))
      );
    }

    onLike();
  }, [enabled, onLike, opacity, reduced, scale]);

  return (
    <Pressable
      onPress={onPress}
      // The gesture is a shortcut for a button that is also on screen, so it
      // is deliberately invisible to assistive tech rather than announcing a
      // second, differently-worded way to do the same thing.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View>
        {children}

        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <Animated.View style={burst}>
            {/* White, not accent: this sits on top of a photo, where the one
                colour that reads over anything is the one the scrim assumes.
                CLAUDE.md §4 names this as the single allowed literal. */}
            <HeartIcon size={96} active color="#FFFFFF" />
          </Animated.View>
        </View>
      </View>
    </Pressable>
  );
}
