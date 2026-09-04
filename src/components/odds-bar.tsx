import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/components/animated';

import { positionPercentages } from '@/lib/format';
import { colors, motion } from '@/theme';

/**
 * The market bar — the app's signature element.
 *
 * Percentages are headcount, not money: "how many friends think this" is the
 * number people actually care about, and it is the loudest thing on the card.
 * The split animates so joining a side visibly moves the market.
 *
 * NativeWind does not wrap `Animated.View`, so the bar itself is styled with
 * plain style objects. Everything around it uses classes.
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
  /** Once resolved, the losing side falls back to grey. */
  winningOption?: 'a' | 'b' | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { a, b } = positionPercentages(countA, countB);

  const flexA = useSharedValue(a);
  const flexB = useSharedValue(b);

  useEffect(() => {
    flexA.value = withSpring(a, motion.settle);
    flexB.value = withSpring(b, motion.settle);
  }, [a, b, flexA, flexB]);

  const styleA = useAnimatedStyle(() => ({ flexGrow: flexA.value }));
  const styleB = useAnimatedStyle(() => ({ flexGrow: flexB.value }));

  const lostA = winningOption === 'b';
  const lostB = winningOption === 'a';

  const barHeight = size === 'sm' ? 8 : size === 'lg' ? 16 : 12;
  const pctClass = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-xl';

  return (
    <View className={size === 'sm' ? 'gap-2' : 'gap-2.5'}>
      <View className="flex-row items-end justify-between gap-4">
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className={`text-xs ${lostA ? 'text-ink-650' : 'text-ink-500'}`}
          >
            {labelA}
          </Text>
          <Text className={`font-display-bold ${pctClass} ${lostA ? 'text-ink-650' : 'text-sideA'}`}>
            {a}%
          </Text>
        </View>

        <View className="flex-1 items-end">
          <Text
            numberOfLines={1}
            className={`text-xs ${lostB ? 'text-ink-650' : 'text-ink-500'}`}
          >
            {labelB}
          </Text>
          <Text className={`font-display-bold ${pctClass} ${lostB ? 'text-ink-650' : 'text-sideB'}`}>
            {b}%
          </Text>
        </View>
      </View>

      {/* Two segments with a hairline gap, so the split reads as a division
          rather than as a progress bar filling up. */}
      <View style={{ flexDirection: 'row', gap: 3, height: barHeight }}>
        <Animated.View
          style={[
            styleA,
            {
              flexBasis: 0,
              minWidth: a === 0 ? 0 : barHeight,
              borderRadius: barHeight / 2,
              backgroundColor: lostA ? colors.ink['750'] : colors.sideA.DEFAULT,
            },
          ]}
        />
        <Animated.View
          style={[
            styleB,
            {
              flexBasis: 0,
              minWidth: b === 0 ? 0 : barHeight,
              borderRadius: barHeight / 2,
              backgroundColor: lostB ? colors.ink['750'] : colors.sideB.DEFAULT,
            },
          ]}
        />
      </View>

      <View className="flex-row items-center justify-between">
        <Text className="text-2xs tracking-normal text-ink-600">
          {countA} {countA === 1 ? 'person' : 'people'}
        </Text>
        <Text className="text-2xs tracking-normal text-ink-600">
          {countB} {countB === 1 ? 'person' : 'people'}
        </Text>
      </View>
    </View>
  );
}
