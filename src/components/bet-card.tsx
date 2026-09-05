import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from '@/components/animated';

import { ClockIcon, LockIcon } from '@/components/icons';
import { Badge, LiveDot, PressableScale } from '@/components/ui';
import type { BetSide, BetStatus, BetWithPositions } from '@/lib/database.types';
import { formatAgorot, formatCountdown } from '@/lib/format';
import { colors, elevation, motion } from '@/theme';
import { OddsBar } from './odds-bar';

const STATUS_TONE: Record<BetStatus, 'open' | 'locked' | 'resolved' | 'cancelled'> = {
  open: 'open',
  locked: 'locked',
  resolved: 'resolved',
  cancelled: 'cancelled',
};

export function countSides(bet: BetWithPositions): { a: number; b: number } {
  const positions = bet.positions ?? [];
  return {
    a: positions.filter((p) => p.side === 'a').length,
    b: positions.filter((p) => p.side === 'b').length,
  };
}

export function mySide(bet: BetWithPositions, userId: string): BetSide | null {
  return (bet.positions ?? []).find((p) => p.user_id === userId)?.side ?? null;
}

/**
 * The hero object of the app — it appears on the home feed and in every group.
 * Everything else on a screen is arranged around these.
 *
 * The hierarchy is deliberate: pot size and the market split are what people
 * scan for, so they get the display face and the colour. The title is the
 * anchor; group, status and deadline are supporting metadata.
 */
export function BetCard({
  bet,
  currentUserId,
  showGroup = false,
  index = 0,
}: {
  bet: BetWithPositions;
  currentUserId: string;
  showGroup?: boolean;
  /** Position in the list, used to stagger the entrance. */
  index?: number;
}) {
  const counts = countSides(bet);
  const side = mySide(bet, currentUserId);
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;
  const isResolved = bet.status === 'resolved';
  const isCancelled = bet.status === 'cancelled';
  const iWon = isResolved && side !== null && side === bet.winning_option;
  const iLost = isResolved && side !== null && side !== bet.winning_option;

  // A settled bet carries its outcome on the edge, so scrolling history reads
  // at a glance without stopping to read the footer.
  const edge = iWon
    ? 'border-owed/35'
    : iLost
      ? 'border-owing/35'
      : side
        ? 'border-brass-500/40'
        : 'border-ink-800';

  const myLabel = side === 'a' ? bet.option_a_label : bet.option_b_label;
  const winningLabel = bet.winning_option === 'a' ? bet.option_a_label : bet.option_b_label;

  return (
    <Animated.View entering={FadeInDown.delay(index * motion.stagger).duration(motion.duration.base)}>
      <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Bet: ${bet.title}`}
          style={elevation.card}
          className={`mb-3 overflow-hidden rounded-[20px] border bg-ink-900 ${edge} ${
            isCancelled ? 'opacity-55' : ''
          }`}
        >
          {/* Header: where it lives, and what state it's in */}
          <View className="flex-row items-center justify-between gap-3 px-5 pt-4">
            <View className="flex-1 flex-row items-center gap-1.5">
              {showGroup && bet.group ? (
                <Text numberOfLines={1} className="text-xs text-ink-600">
                  {bet.group.emoji ?? '🎲'}  {bet.group.name}
                </Text>
              ) : (
                bet.status === 'open' && (
                  <>
                    <LiveDot />
                    <Text className="text-2xs uppercase tracking-[1px] text-ink-600">Live</Text>
                  </>
                )
              )}
            </View>
            <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
          </View>

          {/* Title + pot */}
          <View className="px-5 pb-4 pt-2.5">
            <Text numberOfLines={3} className="font-display text-lg leading-6 text-ink-50">
              {bet.title}
            </Text>

            <View className="mt-2.5 flex-row items-center gap-3">
              <View className="flex-row items-baseline gap-1.5 rounded-full bg-brass-900 px-2.5 py-1">
                <Text className="font-display-bold text-sm text-brass-300">
                  {formatAgorot(bet.total_pot_agorot)}
                </Text>
                <Text className="text-2xs tracking-normal text-brass-400/70">pot</Text>
              </View>

              {countdown && (
                <View className="flex-row items-center gap-1.5">
                  <ClockIcon size={13} color={colors.ink['600']} />
                  <Text className="text-xs text-ink-600">{countdown.replace('Closes in ', '')}</Text>
                </View>
              )}

              {bet.status === 'locked' && (
                <View className="flex-row items-center gap-1.5">
                  <LockIcon size={13} color={colors.ink['600']} />
                  <Text className="text-xs text-ink-600">Locked</Text>
                </View>
              )}
            </View>
          </View>

          <View className="px-5 pb-4">
            <OddsBar
              countA={counts.a}
              countB={counts.b}
              labelA={bet.option_a_label}
              labelB={bet.option_b_label}
              winningOption={isResolved ? bet.winning_option : null}
              size="sm"
            />
          </View>

          {/* Footer: only when this bet involves you */}
          {side && !isResolved && !isCancelled && (
            <View className="flex-row items-center gap-2 border-t border-ink-800 bg-brass-900/40 px-5 py-3">
              <View className="h-1.5 w-1.5 rounded-full bg-brass-400" />
              <Text className="text-xs text-brass-300">
                You&apos;re on <Text className="font-display">{myLabel}</Text>
              </Text>
            </View>
          )}

          {isResolved && side && (
            <View
              className={`flex-row items-center justify-between gap-2 border-t px-5 py-3 ${
                iWon ? 'border-owed/20 bg-owed-shade' : 'border-owing/20 bg-owing-shade'
              }`}
            >
              <Text className={`font-display text-xs ${iWon ? 'text-owed' : 'text-owing'}`}>
                {iWon ? 'You won' : 'You lost'}
              </Text>
              <Text className="text-xs text-ink-600">{winningLabel} took it</Text>
            </View>
          )}
        </PressableScale>
      </Link>
    </Animated.View>
  );
}
