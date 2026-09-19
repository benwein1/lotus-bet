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

import { AppMark } from '@/components/app-mark';
import { APP_NAME } from '@/lib/legal';
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
 * The name is therefore NOT part of that first frame. The native splash is the
 * mark alone, so anything else drawn at hand-off would pop into existence at
 * the seam and give the cut away. It fades up once the mark has settled, which
 * makes it the one deliberate moment in the sequence rather than a mismatch —
 * and it is why the hold is a beat longer than it used to be: a word nobody
 * can read is not worth showing.
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
  const nameOpacity = useSharedValue(0);
  const nameShift = useSharedValue(10);

  useEffect(() => {
    if (reduced) {
      // Neutralised, not removed: the name is present from the first frame and
      // travels nowhere, and the overlay simply fades.
      nameOpacity.value = 1;
      nameShift.value = 0;
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
        // Held through the name's beat, then away.
        withDelay(400, withSpring(1.7, motion.celebrate))
      )
    );

    // Arrives as the mark's dip finishes, so the two read as one gesture
    // rather than two things happening at once.
    nameOpacity.value = withDelay(300, withTiming(1, { duration: 260 }));
    nameShift.value = withDelay(300, withSpring(0, motion.settle));

    opacity.value = withDelay(
      760,
      withTiming(0, { duration: 420 }, (finished) => {
        if (finished) runOnJS(setDone)(true);
      })
    );
  }, [reduced, scale, opacity, nameOpacity, nameShift]);

  const overlay = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const wordmark = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameShift.value }],
  }));

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
            <AppMark size={180} />
          </Animated.View>

          {/*
            Absolutely positioned, and that is the whole point rather than a
            styling preference. A laid-out sibling still occupies its box at
            `opacity: 0`, which lifts the mark off centre from the very first
            frame — so the mark would sit centred on the native splash and
            then jump upward the instant this overlay mounted, giving away
            exactly the seam this component exists to hide. Out of flow, the
            mark stays where the native splash left it.

            It is also a sibling rather than a child of the badge, so the exit
            scale belongs to the mark alone: carrying the word to 1.7 would
            throw it past the screen edge instead of letting it fade.

            The offset is half the mark (90) plus one section gap (28).
            text-3xl is Apple's Large Title and its tracking arrives with the
            size, so nothing here sets letter-spacing by hand.
          */}
          <Animated.Text
            style={[wordmark, styles.wordmark]}
            className="text-3xl font-semibold text-primary"
            accessibilityRole="header"
          >
            {APP_NAME}
          </Animated.Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    position: 'absolute',
    top: '50%',
    marginTop: 118,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
});
