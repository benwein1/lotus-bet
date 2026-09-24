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
 *
 * ---------------------------------------------------------------------------
 * `compact` — the feed's version of the same bar
 * ---------------------------------------------------------------------------
 * The feed card is a glance and the bet screen is the detail, so the bar has
 * two densities rather than two components. Compact drops the caption, drops
 * the headcount, and sets each label beside its percentage instead of above
 * it — three lines of type become one. Everything it drops is still on the bet
 * screen, which is the only other caller and stays `full`.
 *
 * **The labels stay.** Dropping them too would leave "65%  35%" with nothing
 * saying what either number is about, and on a bet that is locked or resolved
 * the option buttons are gone from the card as well, so there would be no
 * second copy anywhere. Beside the figure they cost no height and keep the
 * bar readable on its own.
 */
export function OddsBar({
  slices,
  winningId = null,
  size = 'md',
  onMedia = false,
  compact = false,
  showNames = true,
}: {
  slices: OddsSlice[];
  /** Once resolved, everything that lost falls back to a rule. */
  winningId?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** Over a photo or video, where the palette has to ignore the scheme. */
  onMedia?: boolean;
  /**
   * The feed's density: no caption, no headcount, labels beside the figures
   * rather than above them. Defaults to false so the bet screen and the group
   * screen keep the full bar without saying so.
   */
  compact?: boolean;
  /**
   * Drop the option names, leaving the two figures and the track.
   *
   * The bet screen passes this: the labels are on the option cards a few
   * pixels below, in the colour they belong to and on the thing you press, so
   * printing them again above the bar is the same two words twice.
   */
  showNames?: boolean;
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
    <View className={compact ? 'gap-2' : size === 'sm' ? 'gap-2' : 'gap-2.5'}>
      {/* Naming the denominator once is what stops a percentage being read as
          a probability. It is the share of the people who have picked, not how
          likely anything is. The feed drops it: there the bar is a glance, and
          the bet screen one tap away still says it. */}
      {!compact && (
        <Text numberOfLines={1} className={`text-xs ${muted}`}>
          {caption}
        </Text>
      )}

      {slices.length === 2 ? (
        <TwoUp
          slices={slices}
          shares={shares}
          winningId={winningId}
          size={size}
          onMedia={onMedia}
          scheme={scheme}
          compact={compact}
          showNames={showNames}
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
        // How many people are on each side is detail, not glance — it is the
        // roster on the bet screen, under the option it belongs to.
        compact ? null : (
          <View className="flex-row items-center justify-between">
            {slices.map((slice) => (
              <Text key={slice.id} style={tabular} className={`text-xs ${muted}`}>
                {slice.count} {slice.count === 1 ? 'person' : 'people'}
              </Text>
            ))}
          </View>
        )
      ) : (
        <Legend
          slices={slices}
          shares={shares}
          winningId={winningId}
          onMedia={onMedia}
          scheme={scheme}
          muted={muted}
          compact={compact}
        />
      )}
    </View>
  );
}

/**
 * The two-option layout: a figure at each end, facing outward.
 *
 * The percentage stays at the outer edge in both densities, because that is
 * what ties it to its end of the bar underneath — the left figure and the left
 * segment are the same option, and swapping them would break the only thing
 * making the bar readable without a legend.
 *
 * Full stacks the label above the figure. Compact sets it beside, inboard of
 * the figure, so the row costs one line instead of two and the percentages
 * still sit over the segments they describe.
 */
function TwoUp({
  slices,
  shares,
  winningId,
  size,
  onMedia,
  scheme,
  compact,
  showNames,
}: {
  slices: OddsSlice[];
  shares: number[];
  winningId: string | null;
  size: 'sm' | 'md' | 'lg';
  onMedia: boolean;
  scheme: ColorScheme;
  compact: boolean;
  showNames: boolean;
}) {
  const pctClass = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-lg' : 'text-xl';
  const label = onMedia ? 'text-on-media-soft' : 'text-secondary';
  const muted = onMedia ? 'text-on-media-faint' : 'text-tertiary';

  return (
    <View className="flex-row items-end justify-between gap-4">
      {slices.map((slice, index) => {
        const lost = winningId !== null && winningId !== slice.id;
        const color = optionColor(index, slices.length, scheme, onMedia);
        const figure = (
          <Text
            style={[tabular, lost ? null : { color }]}
            className={`font-bold ${pctClass} ${lost ? muted : ''}`}
          >
            {shares[index]}%
          </Text>
        );
        // `flex-shrink` on the label and not on the figure: a long option name
        // truncates, a percentage never does. Three characters cannot be
        // allowed to wrap or ellipsise on the narrowest iPhone.
        const name = (
          <Text numberOfLines={1} className={`shrink text-sm ${lost ? muted : label}`}>
            {slice.label}
          </Text>
        );

        if (compact) {
          return (
            <View
              key={slice.id}
              className={`flex-1 flex-row items-baseline gap-1.5 ${
                index === 0 ? '' : 'justify-end'
              }`}
            >
              {index === 0 ? (
                <>
                  {figure}
                  {name}
                </>
              ) : (
                <>
                  {name}
                  {figure}
                </>
              )}
            </View>
          );
        }

        return (
          <View key={slice.id} className={index === 0 ? 'flex-1' : 'flex-1 items-end'}>
            {showNames && name}
            {figure}
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

/**
 * Past two options the figures move under the bar, one per line.
 *
 * Compact keeps the whole legend — with four options there is nowhere else the
 * labels could go and the bar would be four anonymous bands — and drops only
 * the headcount column, which is the same thing `compact` drops at two.
 */
function Legend({
  slices,
  shares,
  winningId,
  onMedia,
  scheme,
  muted,
  compact,
}: {
  slices: OddsSlice[];
  shares: number[];
  winningId: string | null;
  onMedia: boolean;
  scheme: ColorScheme;
  muted: string;
  compact: boolean;
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
            {!compact && (
              <Text style={tabular} className={`text-sm ${muted}`}>
                {slice.count}
              </Text>
            )}
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
