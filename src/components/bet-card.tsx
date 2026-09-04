import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Badge } from '@/components/ui';
import type { BetSide, BetStatus, BetWithPositions } from '@/lib/database.types';
import { formatAgorot, formatCountdown } from '@/lib/format';
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
 * The card that appears everywhere — home feed, group feed. Tapping it opens
 * the bet detail, which is where sides are actually taken.
 */
export function BetCard({
  bet,
  currentUserId,
  showGroup = false,
}: {
  bet: BetWithPositions;
  currentUserId: string;
  showGroup?: boolean;
}) {
  const counts = countSides(bet);
  const side = mySide(bet, currentUserId);
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;
  const isResolved = bet.status === 'resolved';
  const iWon = isResolved && side !== null && side === bet.winning_option;
  const iLost = isResolved && side !== null && side !== bet.winning_option;

  // A resolved bet gets a win/loss edge so a scroll through history reads at
  // a glance.
  const border = iWon
    ? 'border-owed/40'
    : iLost
      ? 'border-owing/40'
      : 'border-ink-700/70';

  return (
    <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Bet: ${bet.title}`}
        className={`mb-3 rounded-3xl border bg-ink-900 p-4 active:bg-ink-800 ${border}`}
      >
        <View className="mb-2 flex-row items-center justify-between gap-2">
          <View className="flex-1 flex-row items-center gap-2">
            {showGroup && bet.group && (
              <Text numberOfLines={1} className="text-xs text-ink-600">
                {bet.group.emoji ?? '🎲'} {bet.group.name}
              </Text>
            )}
          </View>
          <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
        </View>

        <Text className="mb-1 text-base font-semibold leading-5 text-white">{bet.title}</Text>

        <View className="mb-3 flex-row items-center gap-2">
          <Text className="text-sm font-semibold text-lotus-400">
            {formatAgorot(bet.total_pot_agorot)} pot
          </Text>
          {countdown && <Text className="text-xs text-ink-600">· {countdown}</Text>}
        </View>

        <OddsBar
          countA={counts.a}
          countB={counts.b}
          labelA={bet.option_a_label}
          labelB={bet.option_b_label}
          winningOption={isResolved ? bet.winning_option : null}
        />

        {side && !isResolved && (
          <Text className="mt-3 text-xs font-semibold text-lotus-400">
            You&apos;re on {side === 'a' ? bet.option_a_label : bet.option_b_label}
          </Text>
        )}

        {isResolved && side && (
          <Text
            className={`mt-3 text-xs font-semibold ${iWon ? 'text-owed' : 'text-owing'}`}
          >
            {iWon ? 'You won' : 'You lost'} · {bet.winning_option === 'a' ? bet.option_a_label : bet.option_b_label} took it
          </Text>
        )}
      </Pressable>
    </Link>
  );
}
