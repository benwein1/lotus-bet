import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

// `className` is silently dropped on expo-image without this; every size here
// goes through the `style` prop anyway, but registering it keeps the component
// usable the same way as the rest of the library.
cssInterop(Image, { className: 'style' });

/**
 * The app mark — the same five-petal form as the home-screen icon.
 *
 * One asset, rendered from `assets/logo/mark.svg` by `scripts/build-icons.mjs`
 * along with the icon, the splash and the favicon. Wherever the app shows its
 * own face — the splash hand-off, the sign-in header, the setup screen — it is
 * this, so the thing you tapped and the thing that opens are recognisably the
 * same object.
 *
 * The PNG has a transparent ground: it sits on whatever is behind it and works
 * in both schemes without a variant.
 */
export function AppMark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/splash-icon.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      // No cross-fade: this is the first thing on screen in two of the three
      // places it appears, and a fade-in there is a flash of nothing.
      transition={0}
      accessibilityLabel="Betta"
    />
  );
}

/**
 * The soft blue bloom the feed header sets behind the wordmark.
 *
 * It is the one piece of decoration in the app, and it is drawn rather than
 * faked with a tinted pill: the design is a radial fade to nothing, and a
 * rounded rectangle at low opacity has a hard edge that reads as a chip
 * behind the name. `react-native-svg` is already here for the icon set, so
 * this costs no dependency.
 *
 * The colour is a literal rather than a token because it is the accent at 20%
 * alpha, and the semantic colours resolve to `var(--c-*)`, which Tailwind
 * cannot take an alpha of — the same rule that gave `on-media-soft` its own
 * entry. An SVG stop takes opacity separately, so the literal stays here
 * instead of adding a palette key nothing else would use.
 */
export function WordmarkGlow({ width = 190, height = 44 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id="wordmark-glow" cx="50%" cy="50%" rx="60%" ry="100%">
          <Stop offset="0" stopColor="#2E92FF" stopOpacity={0.2} />
          <Stop offset="0.72" stopColor="#2E92FF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#wordmark-glow)" />
    </Svg>
  );
}
