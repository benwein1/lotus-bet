import { cssInterop } from 'nativewind';
import Animated from 'react-native-reanimated';

/**
 * NativeWind only wraps the React Native components it knows about, so
 * `className` on a reanimated `Animated.View` is silently dropped — no error,
 * the styles just never arrive. It cost this project a redesign pass: the
 * side-picker buttons on the bet screen stacked on top of each other because
 * `flex-row` never applied.
 *
 * Registering the animated components here teaches NativeWind to map their
 * `className` into `style`, merged with any animated style already passed.
 *
 * Import `Animated` from this module rather than from react-native-reanimated
 * directly, so the registration is guaranteed to have run.
 */
cssInterop(Animated.View, { className: 'style' });
cssInterop(Animated.Text, { className: 'style' });
cssInterop(Animated.ScrollView, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});

export default Animated;
export * from 'react-native-reanimated';
