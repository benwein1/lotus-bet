import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { ChevronRightIcon } from '@/components/icons';
import { PressableScale } from '@/components/ui';
import { normalise, type ChartSeries } from '@/lib/profile-chart';
import { useColors } from '@/providers/theme-provider';

/**
 * Your running total, as one line.
 *
 * The whole chart is the button — not a corner of it, not a caption under it.
 * A chart is a big obvious target and people press charts; a 44px "details"
 * link beside one that also looks pressable is two controls where there is
 * one thing to do.
 *
 * It draws from `ChartSeries`, which is a single currency by construction.
 * There is no exchange rate in this app and there must not be one, so a chart
 * that added two currencies together would be inventing a number.
 */
export function NetChart({
  series,
  width,
  height = 104,
  onPress,
  label,
}: {
  series: ChartSeries;
  width: number;
  height?: number;
  onPress: () => void;
  label: string;
}) {
  const colors = useColors();
  const shape = useMemo(() => normalise(series.points), [series.points]);

  const up = series.net >= 0;
  const stroke = up ? colors.positive : colors.negative;
  const path = shape
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x * width} ${point.y * height}`)
    .join(' ');

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.985}
    >
      <View style={{ height }} className="justify-center">
        {shape.length === 0 ? (
          <Text className="text-sm text-tertiary">
            Your line starts at the first bet somebody calls.
          </Text>
        ) : (
          <Svg width={width} height={height}>
            {[0.25, 0.5, 0.75].map((at) => (
              <Line
                key={at}
                x1={0}
                y1={height * at}
                x2={width}
                y2={height * at}
                stroke={colors.hairline}
                strokeWidth={1}
              />
            ))}
            <Path
              d={path}
              stroke={stroke}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        )}
      </View>
      <View className="mt-1.5 flex-row items-center justify-end gap-1">
        <Text className="text-xs font-semibold text-accent">All stats</Text>
        <ChevronRightIcon size={13} color={colors.accent} />
      </View>
    </PressableScale>
  );
}
