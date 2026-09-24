import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { PlusIcon } from '@/components/icons';
import { PressableScale } from '@/components/ui';
import { useColors } from '@/providers/theme-provider';

/**
 * The create button: a ring of the mark's own green-to-blue ramp around a
 * core the colour of the page.
 *
 * It is deliberately not the accent. Accent blue carries every *action* in
 * this app, and if the one button that makes a new thing looks like every
 * other button, it stops being findable. The ramp is the logo, so the ring
 * reads as "Betta makes something here" — and because it is the same ring on
 * the Groups tab and inside a group, one shape means create wherever you are.
 *
 * `rotated` turns the plus into a close, which is what it becomes while the
 * menu it opened is on screen.
 */
export function RampRing({
  size = 48,
  glyph,
  border = 2.5,
  rotated = false,
  label,
  onPress,
}: {
  size?: number;
  glyph?: number;
  border?: number;
  rotated?: boolean;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: size, height: size, borderRadius: 999, padding: border }}
    >
      <LinearGradient
        colors={[colors.markFrom, colors.markTo]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ flex: 1, borderRadius: 999, padding: border }}
      >
        <View
          style={{ flex: 1, borderRadius: 999, transform: [{ rotate: rotated ? '45deg' : '0deg' }] }}
          className="items-center justify-center bg-canvas"
        >
          <PlusIcon size={glyph ?? Math.round(size * 0.44)} color={colors.text} />
        </View>
      </LinearGradient>
    </PressableScale>
  );
}
