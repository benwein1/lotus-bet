import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { positionPercentages } from '@/lib/format';
import { colors } from '@/theme';

/**
 * Polymarket-style split bar. The percentages are headcount, not money —
 * "how many friends think this" is the number people actually care about.
 *
 * The filled width animates so joining a side visibly moves the market.
 *
 * NativeWind does not wrap `Animated.View`, so the bar itself is styled with
 * plain style objects rather than className. Everything around it uses classes.
 */
export function OddsBar({
  countA,
  countB,
  labelA,
  labelB,
  winningOption = null,
  compact = false,
}: {
  countA: number;
  countB: number;
  labelA: string;
  labelB: string;
  /** Once resolved, the losing side fades back to grey. */
  winningOption?: 'a' | 'b' | null;
  compact?: boolean;
}) {
  const { a, b } = positionPercentages(countA, countB);
  const widthA = useSharedValue(a);

  useEffect(() => {
    widthA.value = withSpring(a, { damping: 18, stiffness: 140 });
  }, [a, widthA]);

  const animatedA = useAnimatedStyle(() => ({ width: `${widthA.value}%` }));

  const dimA = winningOption === 'b';
  const dimB = winningOption === 'a';

  return (
    <View className={compact ? 'gap-1.5' : 'gap-2'}>
      {!compact && (
        <View className="flex-row items-baseline justify-between gap-3">
          <Text
            numberOfLines={1}
            className={`flex-1 text-sm font-semibold ${dimA ? 'text-ink-600' : 'text-sideA'}`}
          >
            {labelA}
          </Text>
          <Text
            numberOfLines={1}
            className={`flex-1 text-right text-sm font-semibold ${dimB ? 'text-ink-600' : 'text-sideB'}`}
          >
            {labelB}
          </Text>
        </View>
      )}

      <View
        style={{
          height: 10,
          borderRadius: 999,
          overflow: 'hidden',
          flexDirection: 'row',
          backgroundColor: dimB ? colors.ink['700'] : colors.sideB,
        }}
      >
        <Animated.View
          style={[
            animatedA,
            { height: '100%', backgroundColor: dimA ? colors.ink['700'] : colors.sideA },
          ]}
        />
      </View>

      <View className="flex-row justify-between">
        <Text className={`text-xs ${dimA ? 'text-ink-600' : 'text-sideA'}`}>
          {a}% · {countA} {countA === 1 ? 'person' : 'people'}
        </Text>
        <Text className={`text-xs ${dimB ? 'text-ink-600' : 'text-sideB'}`}>
          {countB} {countB === 1 ? 'person' : 'people'} · {b}%
        </Text>
      </View>
    </View>
  );
}
