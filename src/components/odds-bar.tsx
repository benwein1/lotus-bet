import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/components/animated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { percentages } from '@/lib/odds';
import type { ColorScheme } from '@/theme';
import { useColors, useScheme } from '@/providers/theme-provider';
import { motion, optionColor, tabular } from '@/theme';

export interface OddsSlice {
  id: string;
  label: string;
  count: number;
}

/**
 * The market bar — the app's signature element.
 *
 * Percentages are headcount, not money: "how many friends think this" is the
 * number people actually care about, and the caption above says so, because
 * "67%" on its own reads as a probability.
 *
 * It takes any number of options. With two it is the familiar green/red split
 * with the figures either side; past two it becomes a stacked bar with a
 * legend, because four percentages cannot sit along one line and stay
 * readable. Same component, same data, one branch on `slices.length`.
 *
 * Every segment animates on `scaleX` over a fixed-width track, never on width
 * or flex. Animating a layout property re-lays-out the row every frame; a
 * transform is composited and costs nothing. This is the one value in the app
 * that changes while the user is watching.
 */
export function OddsBar({
  slices,
  winningId = null,
  size = 'md',
  onMedia = false,
}: {
  slices: OddsSlice[];
  /** Once resolved, everything that lost falls back to a rule. */
  winningId?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** Over a photo or video, where the palette has to ignore the scheme. */
  onMedia?: boolean;
}) {
  const colors = useColors();
  const scheme = useScheme();
  const reduced = useReducedMotion();

  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const shares = percentages(slices);

  const barHeight = size === 'sm' ? 6 : size === 'lg' ? 10 : 8;
  const muted = onMedia ? 'text-on-media-faint' : 'text-tertiary';
  const trackColor = onMedia ? 'rgba(255,255,255,0.22)' : colors.surface3;

  const caption =
    total === 0
      ? 'Nobody has picked a side yet'
      : total === 1
        ? 'One person has picked a side'
        : `Split of the ${total} people who've picked a side`;

  return (
    <View className={size === 'sm' ? 'gap-2' : 'gap-2.5'}>
      {/* Naming the denominator once is what stops a percentage being read as
          a probability. It is the share of the people who have picked, not how
          likely anything is. */}
      <Text numberOfLines={1} className={`text-xs ${muted}`}>
        {caption}
      </Text>

      {slices.length === 2 ? (
        <TwoUp
          slices={slices}
          shares={shares}
          winningId={winningId}
          size={size}
          onMedia={onMedia}
          scheme={scheme}
        />
      ) : null}

      <StackedTrack
        slices={slices}
        shares={shares}
        winningId={winningId}
        height={barHeight}
        trackColor={trackColor}
        onMedia={onMedia}
        scheme={scheme}
        reduced={reduced}
      />

      {slices.length === 2 ? (
        <View className="flex-row items-center justify-between">
          {slices.map((slice) => (
            <Text key={slice.id} style={tabular} className={`text-xs ${muted}`}>
              {slice.count} {slice.count === 1 ? 'person' : 'people'}
            </Text>
          ))}
        </View>
      ) : (
        <Legend
          slices={slices}
          shares={shares}
          winningId={winningId}
          onMedia={onMedia}
          scheme={scheme}
          muted={muted}
        />
      )}
    </View>
  );
}

/** The two-option layout: a figure at each end, facing outward. */
function TwoUp({
  slices,
  shares,
  winningId,
  size,
  onMedia,
  scheme,
}: {
  slices: OddsSlice[];
  shares: number[];
  winningId: string | null;
  size: 'sm' | 'md' | 'lg';
  onMedia: boolean;
  scheme: ColorScheme;
}) {
  const pctClass = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-lg' : 'text-xl';
  const label = onMedia ? 'text-on-media-soft' : 'text-secondary';
  const muted = onMedia ? 'text-on-media-faint' : 'text-tertiary';

  return (
    <View className="flex-row items-end justify-between gap-4">
      {slices.map((slice, index) => {
        const lost = winningId !== null && winningId !== slice.id;
        const color = optionColor(index, slices.length, scheme, onMedia);
        return (
          <View key={slice.id} className={index === 0 ? 'flex-1' : 'flex-1 items-end'}>
            <Text numberOfLines={1} className={`text-sm ${lost ? muted : label}`}>
              {slice.label}
            </Text>
            <Text
              style={[tabular, lost ? null : { color }]}
              className={`font-bold ${pctClass} ${lost ? muted : ''}`}
            >
              {shares[index]}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * One track, one segment per option, laid end to end.
 *
 * Each segment is absolutely positioned at its own offset and scales from its
 * left edge, so the whole bar animates without any of them re-laying out.
 */
function StackedTrack({
  slices,
  shares,
  winningId,
  height,
  trackColor,
  onMedia,
  scheme,
  reduced,
}: {
  slices: OddsSlice[];
  shares: number[];
  winningId: string | null;
  height: number;
  trackColor: string;
  onMedia: boolean;
  scheme: ColorScheme;
  reduced: boolean;
}) {
  // Offsets are cumulative shares, so the segments tile the track exactly.
  let running = 0;
  const placed = slices.map((slice, index) => {
    const offset = running;
    running += shares[index] ?? 0;
    return { slice, index, offset, share: shares[index] ?? 0 };
  });

  return (
    <View
      style={{ height, width: '100%', borderRadius: height / 2, backgroundColor: trackColor }}
      className="overflow-hidden"
    >
      {placed.map(({ slice, index, offset, share }) => (
        <Segment
          key={slice.id}
          offsetPercent={offset}
          sharePercent={share}
          height={height}
          color={
            winningId !== null && winningId !== slice.id
              ? trackColor
              : optionColor(index, slices.length, scheme, onMedia)
          }
          reduced={reduced}
        />
      ))}
    </View>
  );
}

function Segment({
  offsetPercent,
  sharePercent,
  height,
  color,
  reduced,
}: {
  offsetPercent: number;
  sharePercent: number;
  height: number;
  color: string;
  reduced: boolean;
}) {
  const fill = useSharedValue(sharePercent / 100);

  useEffect(() => {
    if (reduced) {
      fill.value = sharePercent / 100;
      return;
    }
    fill.value = withSpring(sharePercent / 100, motion.settle);
  }, [sharePercent, reduced, fill]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  return (
    <Animated.View
      style={[
        style,
        {
          position: 'absolute',
          left: `${offsetPercent}%`,
          height,
          width: '100%',
          transformOrigin: 'left',
          backgroundColor: color,
        },
      ]}
    />
  );
}

/** Past two options the figures move under the bar, one per line. */
function Legend({
  slices,
  shares,
  winningId,
  onMedia,
  scheme,
  muted,
}: {
  slices: OddsSlice[];
  shares: number[];
  winningId: string | null;
  onMedia: boolean;
  scheme: ColorScheme;
  muted: string;
}) {
  const label = onMedia ? 'text-on-media-soft' : 'text-secondary';

  return (
    <View className="gap-1.5">
      {slices.map((slice, index) => {
        const lost = winningId !== null && winningId !== slice.id;
        const color = optionColor(index, slices.length, scheme, onMedia);
        return (
          <View key={slice.id} className="flex-row items-center gap-2">
            <View
              style={{ backgroundColor: lost ? undefined : color }}
              className={`h-2 w-2 rounded-full ${lost ? 'bg-surface3' : ''}`}
            />
            <Text numberOfLines={1} className={`flex-1 text-sm ${lost ? muted : label}`}>
              {slice.label}
            </Text>
            <Text style={tabular} className={`text-sm ${muted}`}>
              {slice.count}
            </Text>
            <Text
              style={[tabular, lost ? null : { color }]}
              className={`w-11 text-right text-sm font-semibold ${lost ? muted : ''}`}
            >
              {shares[index]}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}
