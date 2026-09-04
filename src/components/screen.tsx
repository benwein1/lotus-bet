import { LinearGradient } from 'expo-linear-gradient';
import { View, useWindowDimensions, type ViewProps } from 'react-native';

import { colors } from '@/theme';

/**
 * Every screen sits on this.
 *
 * Two jobs:
 * - A single ambient wash at the top of the page, so screens have depth
 *   instead of reading as flat black rectangles. It is deliberately subtle;
 *   the cards are meant to be the bright things, not the background.
 * - A max width on large screens. The app is phone-first, but it also runs on
 *   tablets and in the browser, where full-bleed content looks broken.
 */
const CONTENT_MAX_WIDTH = 560;

/**
 * Eight-digit hex alpha is not reliably parsed by every LinearGradient
 * backend, and a stop that does not truly reach zero leaves a visible seam
 * where the gradient ends. Build explicit rgba() instead.
 */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ScreenBackdrop({ tint = colors.lotus['600'] }: { tint?: string }) {
  return (
    <LinearGradient
      // Three stops with a long tail, so the wash dissolves instead of ending
      // on a hard horizontal line partway down the screen.
      colors={[withAlpha(tint, 0.16), withAlpha(tint, 0.05), withAlpha(tint, 0)]}
      locations={[0, 0.45, 1]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 460 }}
      pointerEvents="none"
    />
  );
}

/**
 * Centres and constrains content once the viewport is wider than a phone.
 * Use as the `contentContainerStyle` companion inside a ScrollView, or as a
 * plain wrapper.
 */
export function ContentWidth({ className = '', style, ...props }: ViewProps & { className?: string }) {
  const { width } = useWindowDimensions();
  const constrained = width > CONTENT_MAX_WIDTH;

  return (
    <View
      style={[constrained ? { maxWidth: CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' } : null, style]}
      className={className}
      {...props}
    />
  );
}

export { CONTENT_MAX_WIDTH };
