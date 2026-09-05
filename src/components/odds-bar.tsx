import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from '@/components/animated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { positionPercentages } from '@/lib/format';
import { colors, motion, tabular } from '@/theme';

/**
 * The market bar — the app's signature element.
 *
 * Percentages are headcount, not money: "how many friends think this" is the
 * number people actually care about, and it is the loudest thing on the card.
 *
 * The split animates on `scaleX` with a fixed-width track underneath, never on
 * width or flex. Animating a layout property forces a re-layout of the whole
 * row on every frame; a transform is composited and costs nothing. This is the
 * one place in the app where a value changes while the user is watching, so it
 * is the one place where that distinction is visible.
 */
export function OddsBar({
  countA,
  countB,
  labelA,
  labelB,
  winningOption = null,
  size = 'md',
}: {
  countA: number;
  countB: number;
  labelA: string;
  labelB: string;
  /** Once resolved, the losing side falls back to a rule. */
  winningOption?: 'a' | 'b' | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { a, b } = positionPercentages(countA, countB);
  const reduced = useReducedMotion();

  // Both segments are full-width and scale down from their own edge, so the
  // seam between them lands exactly at the split.
  const fillA = useSharedValue(a / 100);
  const fillB = useSharedValue(b / 100);

  useEffect(() => {
    if (reduced) {
      fillA.value = withTiming(a / 100, { duration: 0 });
      fillB.value = withTiming(b / 100, { duration: 0 });
      return;
    }
    fillA.value = withSpring(a / 100, motion.settle);
    fillB.value = withSpring(b / 100, motion.settle);
  }, [a, b, reduced, fillA, fillB]);

  const styleA = useAnimatedStyle(() => ({ transform: [{ scaleX: fillA.value }] }));
  const styleB = useAnimatedStyle(() => ({ transform: [{ scaleX: fillB.value }] }));

  const lostA = winningOption === 'b';
  const lostB = winningOption === 'a';

  const barHeight = size === 'sm' ? 3 : size === 'lg' ? 6 : 4;
  const pctClass = size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-xl' : 'text-2xl';

  return (
    <View className={size === 'sm' ? 'gap-2' : 'gap-3'}>
      <View className="flex-row items-end justify-between gap-4">
        <View className="flex-1">
          <Text numberOfLines={1} className={`text-xs ${lostA ? 'text-ink-650' : 'text-ink-500'}`}>
            {labelA}
          </Text>
          <Text
            style={tabular}
            className={`font-display-bold ${pctClass} ${lostA ? 'text-ink-650' : 'text-sideA'}`}
          >
            {a}
            <Text className={`text-base ${lostA ? 'text-ink-650' : 'text-sideA/50'}`}>%</Text>
          </Text>
        </View>

        <View className="flex-1 items-end">
          <Text numberOfLines={1} className={`text-xs ${lostB ? 'text-ink-650' : 'text-ink-500'}`}>
            {labelB}
          </Text>
          <Text
            style={tabular}
            className={`font-display-bold ${pctClass} ${lostB ? 'text-ink-650' : 'text-sideB'}`}
          >
            {b}
            <Text className={`text-base ${lostB ? 'text-ink-650' : 'text-sideB/50'}`}>%</Text>
          </Text>
        </View>
      </View>

      {/* One full-width track. Both bars span it and scale from opposite edges,
          so they meet exactly at the split — scaling each inside its own half
          would show a third of a half, not a third of the whole. */}
      <View style={{ height: barHeight, width: '100%' }}>
        <Animated.View
          style={[
            styleA,
            {
              position: 'absolute',
              left: 0,
              height: barHeight,
              width: '100%',
              transformOrigin: 'left',
              backgroundColor: lostA ? colors.ink['750'] : colors.sideA.DEFAULT,
            },
          ]}
        />
        <Animated.View
          style={[
            styleB,
            {
              position: 'absolute',
              right: 0,
              height: barHeight,
              width: '100%',
              transformOrigin: 'right',
              backgroundColor: lostB ? colors.ink['750'] : colors.sideB.DEFAULT,
            },
          ]}
        />
      </View>

      <View className="flex-row items-center justify-between">
        <Text style={tabular} className="text-2xs tracking-normal text-ink-600">
          {countA} {countA === 1 ? 'person' : 'people'}
        </Text>
        <Text style={tabular} className="text-2xs tracking-normal text-ink-600">
          {countB} {countB === 1 ? 'person' : 'people'}
        </Text>
      </View>
    </View>
  );
}
