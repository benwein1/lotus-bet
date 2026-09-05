import { BlurView } from 'expo-blur';
import { cssInterop } from 'nativewind';
import { View, useWindowDimensions, type ViewProps } from 'react-native';

import { useScheme } from '@/providers/theme-provider';

// BlurView is not a component NativeWind knows, so its `className` would be
// dropped silently. Register it once, here, and use it everywhere.
cssInterop(BlurView, { className: 'style' });

/**
 * The app is phone-first but also runs on tablets and in a browser, where
 * full-bleed content looks broken. 560 keeps a comfortable measure.
 */
const CONTENT_MAX_WIDTH = 560;

/**
 * Every screen sits on one of two grounds.
 *
 * `canvas` is the plain page — white on light, black on dark — and is right
 * for anything whose content carries its own edges (the feed, a bet). `sunken`
 * is the grouped-list ground: the surrounding tone that makes inset cards read
 * as raised without needing a shadow.
 */
export function Screen({
  ground = 'canvas',
  className = '',
  ...props
}: ViewProps & { ground?: 'canvas' | 'sunken'; className?: string }) {
  return (
    <View className={`flex-1 ${ground === 'sunken' ? 'bg-sunken' : 'bg-canvas'} ${className}`} {...props} />
  );
}

/**
 * A translucent material. Chrome floats over content and lets it show through
 * blurred, rather than consuming an opaque strip of the screen.
 *
 * Bigger surfaces read as thicker: pass a higher intensity for a tab bar than
 * for a chip.
 */
export function Glass({
  intensity = 40,
  className = '',
  style,
  children,
}: {
  intensity?: number;
  className?: string;
  style?: ViewProps['style'];
  children?: React.ReactNode;
}) {
  const scheme = useScheme();

  return (
    <BlurView
      intensity={intensity}
      tint={scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
      style={style}
      // The bright top edge is light catching the material. It is what stops a
      // blurred bar reading as a flat grey rectangle.
      className={`overflow-hidden border border-chrome-edge bg-chrome ${className}`}
    >
      {children}
    </BlurView>
  );
}

/**
 * Centres and constrains content once the viewport is wider than a phone.
 * Use inside a ScrollView's content container, or as a plain wrapper.
 */
export function ContentWidth({
  className = '',
  style,
  ...props
}: ViewProps & { className?: string }) {
  const { width } = useWindowDimensions();
  const constrained = width > CONTENT_MAX_WIDTH;

  return (
    <View
      style={[
        constrained ? { maxWidth: CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' } : null,
        style,
      ]}
      className={className}
      {...props}
    />
  );
}

export { CONTENT_MAX_WIDTH };
