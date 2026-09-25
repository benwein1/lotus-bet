import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

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
 *
 * Four things make it a chart rather than a sparkline, and all four are on the
 * board: a wash under the line so the area reads as accumulated rather than as
 * a wiggle, two rules instead of three so the wash is not sliced up, a dot on
 * the last point because that value is the one the heading prints, and months
 * along the foot so the line has a span. Without the months it is a shape; the
 * axis is what says it took half a year.
 */
export function NetChart({
  series,
  width,
  height = 132,
  onPress,
  label,
}: {
  series: ChartSeries;
  width: number;
  /** The plot's own height. The month labels sit below it. */
  height?: number;
  onPress: () => void;
  label: string;
}) {
  const colors = useColors();
  const shape = useMemo(() => normalise(series.points), [series.points]);
  const ticks = useMemo(() => monthTicks(series.dates), [series.dates]);

  const up = series.net >= 0;
  const stroke = up ? colors.positive : colors.negative;

  const at = (index: number) => ({
    x: (shape[index]?.x ?? 0) * width,
    y: (shape[index]?.y ?? 0) * height,
  });

  const line = shape
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x * width} ${point.y * height}`)
    .join(' ');
  // The same line, closed along the floor, so it can be washed.
  const area = shape.length > 1 ? `${line} L${width} ${height} L0 ${height} Z` : '';
  const last = at(shape.length - 1);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.985}
    >
      <View style={{ height: height + AXIS }} className="justify-center">
        {shape.length === 0 ? (
          <Text className="text-sm text-tertiary">
            Your line starts at the first bet somebody calls.
          </Text>
        ) : (
          <Svg width={width} height={height + AXIS}>
            <Defs>
              <LinearGradient id="net-wash" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
                <Stop offset="1" stopColor={stroke} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* Thirds, not quarters: two rules leave the wash whole. */}
            {[1 / 3, 2 / 3].map((fraction) => (
              <Line
                key={fraction}
                x1={0}
                y1={height * fraction}
                x2={width}
                y2={height * fraction}
                stroke={colors.hairline}
                strokeWidth={1}
              />
            ))}

            {area !== '' && <Path d={area} fill="url(#net-wash)" />}

            <Path
              d={line}
              stroke={stroke}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />

            {/* Where the line got to, which is the figure printed above it. */}
            <Circle cx={last.x} cy={last.y} r={9} fill={stroke} opacity={0.18} />
            <Circle cx={last.x} cy={last.y} r={4.5} fill={stroke} />

            {ticks.map((tick) => (
              <SvgText
                key={`${tick.label}-${tick.at}`}
                x={tick.at * width}
                y={height + AXIS - 3}
                fill={colors.textTertiary}
                fontSize={9}
                letterSpacing={0.8}
                // The first and last labels are pulled inside the plot rather
                // than centred, or half of each would hang off the edge.
                textAnchor={tick.at === 0 ? 'start' : tick.at === 1 ? 'end' : 'middle'}
              >
                {tick.label}
              </SvgText>
            ))}
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

/** Room under the plot for the month labels. */
const AXIS = 16;

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/**
 * Up to four months along the foot, as fractions of the width.
 *
 * Evenly spaced by *position in the series* rather than by date, because that
 * is how the line itself is drawn — `normalise` puts each point at its index,
 * not at its timestamp, so a date-spaced axis would disagree with the shape
 * above it. Duplicates are dropped: four points inside one month should print
 * that month once, not four times.
 */
function monthTicks(dates: string[]): { label: string; at: number }[] {
  if (dates.length < 2) return [];

  const wanted = Math.min(4, dates.length);
  const ticks: { label: string; at: number }[] = [];
  let previous = '';

  for (let i = 0; i < wanted; i += 1) {
    const at = i / (wanted - 1);
    const index = Math.round(at * (dates.length - 1));
    const parsed = new Date(dates[index] ?? '');
    if (Number.isNaN(parsed.getTime())) continue;

    const label = MONTHS[parsed.getMonth()] ?? '';
    if (label === previous) continue;
    previous = label;
    ticks.push({ label, at });
  }

  return ticks;
}
