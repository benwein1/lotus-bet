import { useEffect, useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from '@/components/animated';

/**
 * The mark, as five petals that can move independently.
 *
 * `AppMark` renders the flattened PNG and is right everywhere the mark is just
 * an image. This exists for the one place that needs the petals apart: the
 * splash, where the fan opening *is* the reveal.
 *
 * **Same geometry as `assets/logo/mark.svg`, not a redraw.** One path, rotated
 * about the fan base at (256, 366), five times — which is what makes the mark
 * symmetrical by construction rather than by eye. The group transform that
 * optically centres it is copied across too. If the SVG is ever edited, these
 * constants are what has to follow it.
 *
 * ---------------------------------------------------------------------------
 * The gradient, and why each petal un-rotates its own
 * ---------------------------------------------------------------------------
 * The mark runs one vertical ramp — green at the fan's base, blue at its tips —
 * across the whole shape. `mark.svg` gets that by painting each depth layer
 * through a clip, which keeps the ramp vertical in the mark's space.
 *
 * That shape does not survive here, because these petals rotate at runtime: a
 * clip whose children are animated is not something to rely on, and the rect
 * being clipped would rotate with them anyway. So each petal fills with its own
 * copy of its layer's ramp and cancels its own rotation through
 * `gradientTransform`. At rest — which is every frame anybody actually looks
 * at, and the frame the native splash hands off to — the result is identical to
 * the PNG. The cancellation uses the petal's *final* angle rather than its
 * animated one, so mid-flight the outer pair's ramp is a few degrees off
 * vertical. That is four moving shapes for under 600ms, and it is invisible;
 * animating the gradient to chase it would cost a driven prop per frame per
 * petal to fix something nobody can see.
 *
 * ---------------------------------------------------------------------------
 * One `<Svg>`, five `<G>` — not five `<Svg>` in five Views
 * ---------------------------------------------------------------------------
 * The obvious build is a stack of absolutely-positioned Views, each holding one
 * petal, each rotated by a View transform. It renders, and it is subtly wrong:
 * every petal's base is a razor point at the same coordinate, and five
 * independently rasterised layers land those points a fraction of a pixel
 * apart. The result is a row of small notches where the fan should converge to
 * a single clean tip — visible at 3x, and exactly the kind of thing that makes
 * a logo look slightly off without anybody being able to say why.
 *
 * Inside one `<Svg>` the rasteriser sees one shape set and the bases merge, the
 * way they do in the source file. So the rotation happens on `<G rotation>`
 * through `useAnimatedProps`, and `origin` puts the pivot on the fan base —
 * which also means no manual translate-rotate-translate to get the pivot right.
 *
 * Drawn on react-native-svg, already a dependency for the icon set. Nothing new
 * is installed for this.
 */

const AnimatedG = Animated.createAnimatedComponent(G);

/** The petal, pointing up from the base. Verbatim from `assets/logo/mark.svg`. */
const PETAL = 'M256 366 C 206 292, 200 208, 256 122 C 312 208, 306 292, 256 366 Z';

/** Where every petal pivots, in the 512 viewBox. */
const PIVOT = '256, 366';
const BOX = 512;

/**
 * Back to front, which is the order the SVG lays them down: the outer pair
 * first and furthest back, the centre petal last and at full strength.
 *
 * `delay` staggers the fan opening, outer → inner → centre, so the brightest
 * petal is the last thing to land — the payoff frame.
 */
const PETALS = [
  { angle: -54, ramp: 'outer', delay: 0 },
  { angle: 54, ramp: 'outer', delay: 40 },
  { angle: -27, ramp: 'inner', delay: 80 },
  { angle: 27, ramp: 'inner', delay: 120 },
  { angle: 0, ramp: 'centre', delay: 160 },
] as const;

/**
 * The three ramps, verbatim from `mark.svg`: darkest and furthest back to
 * brightest and on top, each running green at the base to blue at the tip.
 */
const RAMPS = {
  outer: ['#0E5B3A', '#0A4E97'],
  inner: ['#17864F', '#0961BC'],
  centre: ['#22B573', '#2E92FF'],
} as const;

/** Where the ramp starts and ends, in viewBox units. Also from `mark.svg`. */
const RAMP_FROM = 372;
const RAMP_TO = 126;

/**
 * How far the petals collapse toward the centre before opening.
 *
 * The inhale. Not zero — a fan that folds completely shut reads as a glitch
 * rather than a breath, and the first frame has to stay recognisable as the
 * mark because the native splash is already showing it.
 */
const GATHER = 0.34;

/**
 * How far a petal shortens at full gather.
 *
 * Small on purpose. This is the only motion the centre petal has, so it has to
 * be enough to read; much more and the fan looks like it is being squashed
 * rather than drawing breath.
 */
const RETRACT = 0.86;

interface Props {
  size?: number;
  /** Skips the fan entirely and draws the settled mark. */
  still?: boolean;
}

export function AnimatedMark({ size = 180, still = false }: Props) {
  // Gradient ids are global to the document on web, so two marks on one screen
  // — the splash handing off to an auth screen, say — would have the second
  // one's defs silently win. Same reason the realtime channels carry a
  // `useId()` suffix.
  const uid = useId().replace(/:/g, '');
  const rampId = (angle: number) => `betta-ramp-${uid}-${angle < 0 ? 'n' : ''}${Math.abs(angle)}`;

  return (
    <View
      style={{ width: size, height: size }}
      // Five layers of one mark: decorative individually, named once by the
      // splash as a whole.
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
        <Defs>
          {PETALS.map((petal) => {
            const [from, to] = RAMPS[petal.ramp];
            return (
              <LinearGradient
                key={petal.angle}
                id={rampId(petal.angle)}
                gradientUnits="userSpaceOnUse"
                x1={256}
                y1={RAMP_FROM}
                x2={256}
                y2={RAMP_TO}
                // Cancels the petal's own rotation, so the ramp stays vertical
                // in the mark's space rather than running along the petal. See
                // the note at the top of this file.
                gradientTransform={`rotate(${-petal.angle}, 256, 366)`}
              >
                <Stop offset="0" stopColor={from} />
                <Stop offset="1" stopColor={to} />
              </LinearGradient>
            );
          })}
        </Defs>

        {/* The optical centring from `mark.svg`: the fan is wider than it is
            tall, so its bounding box is not the viewBox. Baked in rather than
            animated — it never changes. */}
        <G transform="translate(256 256) scale(1.16) translate(-256 -251)">
          {PETALS.map((petal) => (
            <Petal key={petal.angle} petal={petal} fill={`url(#${rampId(petal.angle)})`} still={still} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

function Petal({
  petal,
  fill,
  still,
}: {
  petal: (typeof PETALS)[number];
  fill: string;
  still: boolean;
}) {
  // Each petal carries its own clock so the fan can stagger. One shared value
  // would open all five together, which is a scale, not a fan.
  //
  // 0 is fully gathered, 1 is the true angle. It *starts* at 1 because the
  // native splash is already showing the finished mark — beginning at 0 would
  // pop the logo out of existence on the first frame and give away the hand-off
  // the splash exists to hide.
  const open = useSharedValue(1);

  useEffect(() => {
    if (still) return;
    open.value = withDelay(
      petal.delay,
      withSequence(
        // The inhale.
        withTiming(GATHER, { duration: 180 }),
        // ...and the fan, with just enough overshoot to feel physical. 0.72 is
        // looser than `motion.settle` and tighter than `motion.celebrate`: a
        // logo that wobbles is a toy, one that lands dead is a slide.
        withSpring(1, { duration: 520, dampingRatio: 0.72 })
      )
    );
  }, [open, petal.delay, still]);

  // Rotation alone leaves the centre petal inert: its angle is 0, so
  // `0 * progress` is 0 at every point of the gather and the brightest petal —
  // the one the whole stagger builds toward — just sits there while the other
  // four breathe around it. A scale about the same pivot gives every petal a
  // way to participate, and reads as the fan retracting into its base rather
  // than merely narrowing.
  const animatedProps = useAnimatedProps(() => ({
    rotation: petal.angle * open.value,
    scale: RETRACT + (1 - RETRACT) * open.value,
  }));

  return (
    <AnimatedG
      // `origin` is the fan base in viewBox units, so the petal swings from
      // where it is joined rather than from the middle of the box.
      origin={PIVOT}
      rotation={still ? petal.angle : undefined}
      scale={still ? 1 : undefined}
      animatedProps={still ? undefined : animatedProps}
    >
      <Path d={PETAL} fill={fill} />
    </AnimatedG>
  );
}

export { PETALS as MARK_PETALS };
