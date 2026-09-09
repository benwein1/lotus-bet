import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';

// `className` is silently dropped on expo-image without this; every size here
// goes through the `style` prop anyway, but registering it keeps the component
// usable the same way as the rest of the library.
cssInterop(Image, { className: 'style' });

/**
 * The app mark — the same five-petal lotus as the home-screen icon.
 *
 * One asset, rendered from `assets/logo/lotus.svg` by `scripts/build-icons.mjs`
 * along with the icon, the splash and the favicon. Wherever the app shows its
 * own face — the splash hand-off, the sign-in header, the setup screen — it is
 * this, so the thing you tapped and the thing that opens are recognisably the
 * same object.
 *
 * The PNG has a transparent ground: it sits on whatever is behind it and works
 * in both schemes without a variant.
 */
export function LotusMark({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/splash-icon.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      // No cross-fade: this is the first thing on screen in two of the three
      // places it appears, and a fade-in there is a flash of nothing.
      transition={0}
      accessibilityLabel="Lotus Bet"
    />
  );
}
