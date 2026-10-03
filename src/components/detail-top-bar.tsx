import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons';
import { PressableScale } from '@/components/ui';
import { useColors } from '@/providers/theme-provider';

/**
 * The only chrome a pushed screen gets: 52pt tall, a 40pt target at the left
 * edge, and nothing else.
 *
 * The approved design gives the bet and the group no navigation bar. Both name
 * themselves in their own content — the group at Title 2, the bet as its
 * question over its photo — so a bar above would print the same words twice
 * and cost 100pt doing it. What the bar was actually for is the back button,
 * and that floats.
 *
 * `box-none` on the frame, so only the button takes a press: everything
 * underneath keeps its own gestures, including the bet hero's double-tap.
 */
export function DetailTopBar({
  onBack,
  onMedia = false,
}: {
  onBack: () => void;
  /** White chevron, for a screen whose top is a photo rather than the page. */
  onMedia?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{ top: insets.top }}
      className="absolute inset-x-0 z-10 h-[52px] flex-row items-center px-2"
    >
      <PressableScale
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        className="h-10 w-10 items-center justify-center"
      >
        <ChevronLeftIcon size={22} color={onMedia ? colors.onMedia : colors.text} />
      </PressableScale>
    </View>
  );
}
