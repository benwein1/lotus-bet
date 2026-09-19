import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from '@/components/animated';

import { AnimatedMark } from '@/components/animated-mark';
import { APP_NAME } from '@/lib/legal';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

/**
 * The hand-off from the native splash into the app.
 *
 * ---------------------------------------------------------------------------
 * The constraint that shapes everything
 * ---------------------------------------------------------------------------
 * `expo-splash-screen` is already showing the mark — 180px, centred, on the
 * scheme's canvas — for however long the bundle takes to load. So this cannot
 * be a reveal *from nothing*: the logo has been on screen for a second already,
 * and starting from an empty ground would blink it out of existence on the
 * first frame and give away the seam.
 *
 * So the anticipation is an **inhale**. The fan gathers inward, holds for a
 * breath, and opens again petal by petal. It reads as the mark drawing itself
 * together to introduce the app rather than as a loader finishing — and it is
 * the logo's own geometry doing it, since the mark *is* one petal rotated five
 * times about a single point.
 *
 * The whole sequence is transform and opacity only. No width, no layout, no
 * re-measure: it runs on the UI thread and does not touch the app mounting
 * underneath it.
 *
 * ---------------------------------------------------------------------------
 * The timeline, ~1.9s
 * ---------------------------------------------------------------------------
 *    0ms  the finished mark, exactly as the native splash left it. Invisible cut.
 *    0ms  a soft accent glow begins blooming behind it — the cue that something
 *         is about to happen, before anything has moved.
 *   60ms  the fan gathers (`AnimatedMark` owns this), staggered outer → inner →
 *         centre, so the brightest petal is the last to land.
 *  240ms  it opens again, with a little overshoot.
 *  560ms  the wordmark rises and fades up, once the mark has settled. A word
 *         nobody can read yet is not worth showing.
 *  760ms  the glow fades back out; the logo is complete and still.
 * 1150ms  the exit begins — and it is one move, not a cut. See below.
 * 1900ms  the overlay unmounts.
 *
 * ---------------------------------------------------------------------------
 * The exit is deliberately not a fade-out
 * ---------------------------------------------------------------------------
 * The ground goes first and the logo goes second. For about 260ms the feed is
 * already visible *behind* a logo that is still there, drifting up and growing
 * slightly — so the app arrives underneath the mark rather than replacing it.
 * Fading the whole overlay as one layer is what makes a splash feel like a
 * slide that ended; separating the two is what makes it feel like one gesture.
 *
 * Under reduced motion none of this happens: the mark is drawn settled, the
 * name is present from the first frame, and the overlay simply fades. Motion is
 * neutralised, never removed — the app is live underneath the whole time and
 * the overlay stops taking touches the moment it starts leaving.
 */

/** When the exit starts. Everything before this is the reveal. */
const EXIT_AT = 1150;

/** Comfortably larger than the 180px mark, so the falloff never shows an edge. */
const GLOW_SIZE = 300;

export function AnimatedSplash({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const reduced = useReducedMotion();

  // Kept in state as well as on the UI thread, so the overlay is unmounted
  // rather than left as a transparent view swallowing nothing forever.
  const [done, setDone] = useState(false);

  // Two grounds, not one: the backdrop leaves before the logo does.
  const ground = useSharedValue(1);
  const logo = useSharedValue(1);
  const lift = useSharedValue(0);
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const nameOpacity = useSharedValue(0);
  const nameShift = useSharedValue(12);

  useEffect(() => {
    if (reduced) {
      nameOpacity.value = 1;
      nameShift.value = 0;
      ground.value = withTiming(0, { duration: motion.duration.base });
      logo.value = withTiming(0, { duration: motion.duration.base }, (finished) => {
        if (finished) runOnJS(setDone)(true);
      });
      return;
    }

    // The cue, before anything moves. Blooms with the gather and is gone by the
    // time the logo settles, so it reads as light gathering rather than as a
    // glow that got left switched on.
    glow.value = withSequence(
      withTiming(1, { duration: 420 }),
      withDelay(180, withTiming(0, { duration: 420 }))
    );

    // The mark breathes with its own fan: down as the petals gather, back up as
    // they open. `AnimatedMark` owns the petals; this is the whole-logo part.
    scale.value = withSequence(
      withTiming(0.95, { duration: 180 }),
      withSpring(1, { duration: 520, dampingRatio: 0.72 }),
      // The exit lift, folded into the same value so there is no second spring
      // fighting the settle.
      withDelay(EXIT_AT - 700, withTiming(1.12, { duration: 620 }))
    );

    // Arrives after the fan has opened and settled.
    nameOpacity.value = withDelay(560, withTiming(1, { duration: 280 }));
    nameShift.value = withDelay(560, withSpring(0, motion.settle));

    // The ground first...
    ground.value = withDelay(EXIT_AT, withTiming(0, { duration: 420 }));
    // ...then the logo, 260ms behind it, over the feed that is already there.
    lift.value = withDelay(EXIT_AT, withTiming(-28, { duration: 620 }));
    logo.value = withDelay(
      EXIT_AT + 260,
      withTiming(0, { duration: 420 }, (finished) => {
        if (finished) runOnJS(setDone)(true);
      })
    );
  }, [reduced, ground, logo, lift, scale, glow, nameOpacity, nameShift]);

  const groundStyle = useAnimatedStyle(() => ({ opacity: ground.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logo.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.7 + glow.value * 0.55 }],
  }));
  const wordmark = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameShift.value }],
  }));

  return (
    <View className="flex-1">
      {children}

      {!done && (
        <View
          // `pointerEvents` on the wrapper rather than a state flag: the app
          // underneath is interactive from the first frame, and a splash that
          // eats the first tap is worse than no splash.
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        >
          {/* The backdrop is its own layer so it can leave before the logo. */}
          <Animated.View
            style={[StyleSheet.absoluteFill, groundStyle, { backgroundColor: colors.canvas }]}
          />

          <Animated.View
            style={[StyleSheet.absoluteFill, logoStyle]}
            className="items-center justify-center"
          >
            <View className="items-center justify-center">
              {/*
                The glow, as an SVG radial gradient rather than a shadow or a
                `LinearGradient`.

                A `shadowRadius` disc was the first attempt and is wrong on
                Android, where shadows need `elevation` and a radius alone
                renders nothing — leaving a hard-edged blue circle at half
                opacity behind the mark. `LinearGradient` is the other trap:
                its eight-digit hex alpha is unreliable and leaves a seam
                wherever a stop does not truly reach zero (CLAUDE.md §4).

                `RadialGradient` with explicit `stopOpacity` has neither
                problem and draws the same on all three platforms. The falloff
                is deliberately gentle and stops well short of the edge, so
                there is no visible rim.
              */}
              <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
                <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
                  <Defs>
                    <RadialGradient id="markGlow" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor={colors.accent} stopOpacity={0.55} />
                      <Stop offset="45%" stopColor={colors.accent} stopOpacity={0.22} />
                      <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Circle
                    cx={GLOW_SIZE / 2}
                    cy={GLOW_SIZE / 2}
                    r={GLOW_SIZE / 2}
                    fill="url(#markGlow)"
                  />
                </Svg>
              </Animated.View>

              <AnimatedMark size={180} still={reduced} />
            </View>

            {/*
              Absolutely positioned, and that is the point rather than a
              styling preference. A laid-out sibling still occupies its box at
              `opacity: 0`, which lifts the mark off centre from the very first
              frame — so the mark would sit centred on the native splash and
              then jump upward the instant this overlay mounted, giving away
              exactly the seam this component exists to hide.

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
        </View>
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
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
  },
});
