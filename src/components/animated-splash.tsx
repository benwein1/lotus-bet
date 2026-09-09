import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from '@/components/animated';

import { LotusMark } from '@/components/lotus-mark';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

/**
 * The hand-off from the native splash into the app.
 *
 * `expo-splash-screen` shows a static image while the JS bundle loads, and
 * then it vanishes — a hard cut from a logo on a coloured field to a fully
 * drawn screen. This covers that cut: it renders the *same* mark on the *same*
 * ground, so the moment the native splash goes away nothing appears to change,
 * and then the mark takes a breath, scales up and fades, revealing the app
 * underneath.
 *
 * The two halves of the illusion both matter. The ground has to be the
 * scheme's canvas, which is what `app.json`'s splash `backgroundColor` and its
 * `dark` variant are set to; and the mark has to be the same asset at the same
 * size, which is why `imageWidth` there is 180 and this renders at 180.
 *
 * Under reduced motion it simply fades, and quickly. Nothing here is ever
 * something the user has to wait out: the app is live underneath the whole
 * time, and the overlay stops taking touches the moment it starts leaving.
 */
export function AnimatedSplash({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const reduced = useReducedMotion();

  // Kept in state as well as on the UI thread, so the overlay is unmounted
  // rather than left as a transparent view swallowing nothing forever.
  const [done, setDone] = useState(false);

  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      opacity.value = withTiming(0, { duration: motion.duration.base }, (finished) => {
        if (finished) runOnJS(setDone)(true);
      });
      return;
    }

    // A beat on the mark, then away. The dip before the scale is what makes it
    // read as the logo *leaving* rather than the screen cutting: it settles in
    // first, the way a held breath does.
    scale.value = withDelay(
      120,
      withSequence(
        withSpring(0.92, { duration: 260, dampingRatio: 1 }),
        withSpring(1.7, motion.celebrate)
      )
    );

    opacity.value = withDelay(
      300,
      withTiming(0, { duration: 420 }, (finished) => {
        if (finished) runOnJS(setDone)(true);
      })
    );
  }, [reduced, scale, opacity]);

  const overlay = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View className="flex-1">
      {children}

      {!done && (
        <Animated.View
          // `pointerEvents` on the animated view rather than a state flag: the
          // app underneath is interactive from the first frame, and a splash
          // that eats the first tap is worse than no splash.
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, overlay, { backgroundColor: colors.canvas }]}
          className="items-center justify-center"
        >
          <Animated.View style={badge}>
            <LotusMark size={180} />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}
