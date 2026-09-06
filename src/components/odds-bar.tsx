import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/components/animated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { positionPercentages } from '@/lib/format';
import { useColors } from '@/providers/theme-provider';
import { motion, palettes, tabular } from '@/theme';

/**
 * The market bar — the app's signature element.
 *
 * Percentages are headcount, not money: "how many friends think this" is the
 * number people actually care about.
 *
 * The split animates on `scaleX` over a fixed-width track, never on width or
 * flex. Animating a layout property re-lays-out the whole row every frame; a
 * transform is composited and costs nothing. This is the one value in the app
 * that changes while the user is watching, so it is the one place where that
 * distinction is visible.
 */
export function OddsBar({
  countA,
  countB,
  labelA,
  labelB,
  winningOption = null,
  size = 'md',
  onMedia = false,
}: {
  countA: number;
  countB: number;
  labelA: string;
  labelB: string;
  /** Once resolved, the losing side falls back to a rule. */
  winningOption?: 'a' | 'b' | null;
  size?: 'sm' | 'md' | 'lg';
  /** Over a photo or video, where the palette has to ignore the scheme. */
  onMedia?: boolean;
}) {
  const colors = useColors();
  const { a, b } = positionPercentages(countA, countB);
  const reduced = useReducedMotion();

  const fillA = useSharedValue(a / 100);
  const fillB = useSharedValue(b / 100);

  useEffect(() => {
    if (reduced) {
      fillA.value = a / 100;
      fillB.value = b / 100;
      return;
    }
    fillA.value = withSpring(a / 100, motion.settle);
    fillB.value = withSpring(b / 100, motion.settle);
  }, [a, b, reduced, fillA, fillB]);

  const styleA = useAnimatedStyle(() => ({ transform: [{ scaleX: fillA.value }] }));
  const styleB = useAnimatedStyle(() => ({ transform: [{ scaleX: fillB.value }] }));

  const lostA = winningOption === 'b';
  const lostB = winningOption === 'a';

  const barHeight = size === 'sm' ? 6 : size === 'lg' ? 10 : 8;
  const pctClass = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-lg' : 'text-xl';

  const label = onMedia ? 'text-on-media-soft' : 'text-secondary';
  const muted = onMedia ? 'text-on-media-faint' : 'text-tertiary';
  const trackColor = onMedia ? 'rgba(255,255,255,0.22)' : colors.surface3;

  // "On media" always means "over a dark scrim", whatever the app's scheme is
  // doing, so the right green and red there are the dark palette's — bright
  // enough to hold against a photo. Reading them off `palettes` keeps this
  // from becoming two more hardcoded hexes in a component.
  const sideColors = onMedia ? palettes.dark : colors;
  const colorA = lostA ? trackColor : sideColors.sideA;
  const colorB = lostB ? trackColor : sideColors.sideB;

  return (
    <View className={size === 'sm' ? 'gap-2' : 'gap-2.5'}>
      <View className="flex-row items-end justify-between gap-4">
        <View className="flex-1">
          <Text numberOfLines={1} className={`text-sm ${lostA ? muted : label}`}>
            {labelA}
          </Text>
          {/* The percentage takes the colour of the bar under it. A class
              cannot express "the dark palette's green whatever the scheme is",
              which is what a label over a photo needs, so the colour is
              applied as a style — the one case §4 leaves open. */}
          <Text
            style={[tabular, lostA ? null : { color: colorA }]}
            className={`font-bold ${pctClass} ${lostA ? muted : ''}`}
          >
            {a}%
          </Text>
        </View>

        <View className="flex-1 items-end">
          <Text numberOfLines={1} className={`text-sm ${lostB ? muted : label}`}>
            {labelB}
          </Text>
          <Text
            style={[tabular, lostB ? null : { color: colorB }]}
            className={`font-bold ${pctClass} ${lostB ? muted : ''}`}
          >
            {b}%
          </Text>
        </View>
      </View>

      {/* One full-width track. Both bars span it and scale from opposite edges,
          so they meet exactly at the split — scaling each inside its own half
          would show a third of a half, not a third of the whole. */}
      <View
        style={{ height: barHeight, width: '100%', borderRadius: barHeight / 2, backgroundColor: trackColor }}
        className="overflow-hidden"
      >
        <Animated.View
          style={[
            styleA,
            {
              position: 'absolute',
              left: 0,
              height: barHeight,
              width: '100%',
              borderRadius: barHeight / 2,
              transformOrigin: 'left',
              backgroundColor: colorA,
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
              borderRadius: barHeight / 2,
              transformOrigin: 'right',
              backgroundColor: colorB,
            },
          ]}
        />
      </View>

      <View className="flex-row items-center justify-between">
        <Text style={tabular} className={`text-xs ${muted}`}>
          {countA} {countA === 1 ? 'person' : 'people'}
        </Text>
        <Text style={tabular} className={`text-xs ${muted}`}>
          {countB} {countB === 1 ? 'person' : 'people'}
        </Text>
      </View>
    </View>
  );
}
