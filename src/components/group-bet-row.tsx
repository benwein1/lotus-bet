import { Link } from 'expo-router';
import { View, Text } from 'react-native';

import { LiveDot, Money, PressableScale } from '@/components/ui';
import { betSlices } from '@/components/bet-card';
import { isForfeit } from '@/lib/currency';
import { percentages } from '@/lib/odds';
import { formatCountdown } from '@/lib/format';
import type { BetWithPositions } from '@/lib/database.types';
import { useColors, useScheme } from '@/providers/theme-provider';
import { optionColor } from '@/theme';

/**
 * A bet inside its own group.
 *
 * Deliberately not the feed card: in here you already know the group, you are
 * scanning rather than reading, and the odds are a 3px rule under the question
 * instead of two large figures above it. State, time and pot on one line; the
 * question; the split. Nothing else fits in a list you mean to get through.
 */
export function GroupBetRow({ bet }: { bet: BetWithPositions }) {
  const colors = useColors();
  const scheme = useScheme();
  const slices = betSlices(bet);
  const shares = percentages(slices);
  const live = bet.status === 'open' || bet.status === 'locked';
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;

  const meta =
    countdown?.replace('Closes in ', '') ??
    (bet.status === 'resolved' ? 'Settled' : bet.status === 'cancelled' ? 'Cancelled' : 'Locked');

  return (
    <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
      <PressableScale
        scaleTo={0.99}
        accessibilityRole="button"
        accessibilityLabel={`Bet: ${bet.title}`}
        className="mb-3 rounded-[20px] border border-hairline bg-surface p-[15px]"
      >
        <View className="flex-row items-center gap-2.5">
          {live ? (
            <LiveDot />
          ) : (
            <View className="h-1.5 w-1.5 rounded-full bg-hairline-strong" />
          )}
          <Text numberOfLines={1} className="flex-1 text-xs text-secondary">
            {meta}
          </Text>
          {/* Neutral: the pot is not a direction. A forfeit takes the same
              slot as words, clamped to the line rather than wrapping the
              row. */}
          {isForfeit(bet) ? (
            <Text numberOfLines={1} className="max-w-[55%] text-subhead font-bold text-primary">
              {bet.stake_text}
            </Text>
          ) : (
            <Money
              agorot={bet.total_pot_agorot}
              currency={bet.group?.currency}
              size="sm"
              tone="neutral"
              className="text-subhead font-bold"
            />
          )}
        </View>

        <Text
          numberOfLines={2}
          className="mt-2.5 text-base font-semibold leading-[22px] tracking-[-0.3px] text-primary"
        >
          {bet.title}
        </Text>

        <View className="mt-3.5 h-[3px] flex-row overflow-hidden bg-surface3">
          {slices.map((slice, index) => (
            <View
              key={slice.id}
              style={{
                width: `${shares[index] ?? 0}%`,
                backgroundColor: optionColor(index, slices.length, scheme),
              }}
            />
          ))}
        </View>
      </PressableScale>
    </Link>
  );
}
