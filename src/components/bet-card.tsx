import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetMediaView } from '@/components/bet-media';
import { ClockIcon, LockIcon } from '@/components/icons';
import { OddsBar } from '@/components/odds-bar';
import { Badge, LiveDot, Money, PressableScale, tap } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetSide, BetStatus, BetWithPositions } from '@/lib/database.types';
import { formatCountdown } from '@/lib/format';
import { useColors } from '@/providers/theme-provider';
import { elevation, motion, tabular } from '@/theme';

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
 * The feed card — one bet, most of a screen.
 *
 * When the bet has a photo or video it fills the frame and everything else
 * sits on top of it, the way a post reads anywhere else. Without media the
 * card falls back to type: the question gets the whole card, because on a
 * text-only bet the question *is* the content.
 */
export function FeedCard({
  bet,
  currentUserId,
  height,
  active = false,
  onPickSide,
  busySide = null,
}: {
  bet: BetWithPositions;
  currentUserId: string;
  height: number;
  /** True when this is the card on screen — only that one plays its video. */
  active?: boolean;
  onPickSide?: (side: BetSide) => void;
  busySide?: BetSide | null;
}) {
  const colors = useColors();
  const counts = countSides(bet);
  const side = mySide(bet, currentUserId);
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;
  const media = bet.media ?? [];
  const hasMedia = media.length > 0;
  const joinable = bet.status === 'open' && Boolean(onPickSide);

  // Over an image the palette has to stop following the colour scheme: white
  // on a scrim is legible over anything, a semantic label colour is not.
  const titleClass = hasMedia ? 'text-on-media' : 'text-primary';
  const metaClass = hasMedia ? 'text-on-media-soft' : 'text-secondary';

  return (
    <View
      style={[{ height }, hasMedia ? elevation.card : null]}
      className={`overflow-hidden rounded-4xl ${
        hasMedia ? 'bg-black' : 'border border-hairline bg-surface'
      }`}
    >
      {hasMedia && (
        <>
          <BetMediaView media={media} active={active} className="absolute inset-0" />
          {/* Explicit rgba, never eight-digit hex: a stop that does not truly
              reach zero leaves a hard seam where the gradient ends. */}
          <LinearGradient
            colors={[
              'rgba(0,0,0,0.55)',
              'rgba(0,0,0,0.12)',
              'rgba(0,0,0,0.35)',
              'rgba(0,0,0,0.86)',
            ]}
            locations={[0, 0.32, 0.6, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
          />
        </>
      )}

      <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
        <PressableScale
          scaleTo={0.99}
          accessibilityRole="button"
          accessibilityLabel={`Bet: ${bet.title}`}
          className="flex-1 justify-between p-5"
        >
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 flex-row items-center gap-2">
              {bet.group && (
                <>
                  <Text className="text-base">{bet.group.emoji ?? '🎲'}</Text>
                  <Text numberOfLines={1} className={`flex-1 text-sm ${metaClass}`}>
                    {bet.group.name}
                  </Text>
                </>
              )}
            </View>
            {bet.status === 'open' ? (
              <View className="flex-row items-center gap-1.5 rounded-full bg-scrim px-2.5 py-1">
                <LiveDot />
                <Text className="text-xs font-semibold text-on-media">Live</Text>
              </View>
            ) : (
              <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
            )}
          </View>

          {/* Without a photo the question *is* the content, so it takes the
              space the media would have had rather than leaving a void at the
              top of the card. */}
          {!hasMedia && (
            <View className="flex-1 justify-center py-6">
              <Text numberOfLines={6} className="text-4xl font-bold text-primary">
                {bet.title}
              </Text>
              {bet.description && (
                <Text numberOfLines={3} className="mt-3 text-callout leading-5 text-secondary">
                  {bet.description}
                </Text>
              )}
            </View>
          )}

          <View>
            {hasMedia && (
              <Text numberOfLines={3} className={`text-2xl font-bold ${titleClass}`}>
                {bet.title}
              </Text>
            )}

            <View className={`${hasMedia ? 'mt-3' : ''} flex-row items-center gap-4`}>
              <View className="flex-row items-baseline gap-1.5">
                <Money
                  agorot={bet.total_pot_agorot}
                  size="md"
                  tone={hasMedia ? 'onMedia' : 'accent'}
                />
                <Text className={`text-sm ${metaClass}`}>pot</Text>
              </View>

              {countdown && (
                <View className="flex-row items-center gap-1.5">
                  <ClockIcon
                    size={14}
                    color={hasMedia ? colors.onMediaSoft : colors.textSecondary}
                  />
                  <Text style={tabular} className={`text-sm ${metaClass}`}>
                    {countdown.replace('Closes in ', '')}
                  </Text>
                </View>
              )}

              {bet.status === 'locked' && (
                <View className="flex-row items-center gap-1.5">
                  <LockIcon
                    size={14}
                    color={hasMedia ? colors.onMediaSoft : colors.textSecondary}
                  />
                  <Text className={`text-sm ${metaClass}`}>Locked</Text>
                </View>
              )}
            </View>

            <View className="mt-5">
              <OddsBar
                countA={counts.a}
                countB={counts.b}
                labelA={bet.option_a_label}
                labelB={bet.option_b_label}
                onMedia={hasMedia}
              />
            </View>

            {joinable && (
              <View className="mt-5 flex-row gap-3">
                <SidePick
                  label={bet.option_a_label}
                  tone="a"
                  selected={side === 'a'}
                  onMedia={hasMedia}
                  busy={busySide === 'a'}
                  onPress={() => {
                    tap();
                    onPickSide?.('a');
                  }}
                />
                <SidePick
                  label={bet.option_b_label}
                  tone="b"
                  selected={side === 'b'}
                  onMedia={hasMedia}
                  busy={busySide === 'b'}
                  onPress={() => {
                    tap();
                    onPickSide?.('b');
                  }}
                />
              </View>
            )}
          </View>
        </PressableScale>
      </Link>
    </View>
  );
}

/**
 * Picking a side without leaving the feed. Tailwind needs literal class
 * strings, so both branches are spelled out rather than interpolated.
 */
function SidePick({
  label,
  tone,
  selected,
  onMedia,
  busy,
  onPress,
}: {
  label: string;
  tone: 'a' | 'b';
  selected: boolean;
  onMedia: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const base = 'h-12 flex-1 items-center justify-center rounded-2xl border px-3';

  const container = selected
    ? tone === 'a'
      ? 'border-sideA bg-sideA'
      : 'border-sideB bg-sideB'
    : onMedia
      ? 'border-chrome-edge bg-scrim'
      : 'border-hairline bg-surface2';

  const text = selected
    ? tone === 'a'
      ? 'text-accent-ink'
      : 'text-canvas'
    : onMedia
      ? 'text-on-media'
      : 'text-primary';

  return (
    <PressableScale
      scaleTo={0.96}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected, busy }}
      accessibilityLabel={`Back ${label}`}
      className={`${base} ${container} ${busy ? 'opacity-60' : ''}`}
    >
      <Text numberOfLines={1} className={`text-subhead font-semibold ${text}`}>
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * The compact card, used inside a group where a list of bets has to be
 * scannable rather than immersive.
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
  const colors = useColors();
  const reduced = useReducedMotion();
  const counts = countSides(bet);
  const side = mySide(bet, currentUserId);
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;
  const isResolved = bet.status === 'resolved';
  const isCancelled = bet.status === 'cancelled';
  const iWon = isResolved && side !== null && side === bet.winning_option;
  const media = bet.media ?? [];

  const myLabel = side === 'a' ? bet.option_a_label : bet.option_b_label;
  const winningLabel = bet.winning_option === 'a' ? bet.option_a_label : bet.option_b_label;

  return (
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : FadeInDown.delay(Math.min(index, 6) * motion.stagger).duration(motion.duration.base)
      }
    >
      <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Bet: ${bet.title}`}
          className={`mb-3 overflow-hidden rounded-3xl border border-hairline bg-surface ${
            isCancelled ? 'opacity-50' : ''
          }`}
        >
          {media.length > 0 && <BetMediaView media={media} className="h-40 w-full" />}

          <View className="p-4">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 flex-row items-center gap-1.5">
                {showGroup && bet.group ? (
                  <Text numberOfLines={1} className="text-sm text-secondary">
                    {bet.group.emoji ?? '🎲'}  {bet.group.name}
                  </Text>
                ) : (
                  bet.status === 'open' && (
                    <>
                      <LiveDot />
                      <Text className="text-sm text-secondary">Live</Text>
                    </>
                  )
                )}
              </View>
              <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
            </View>

            <Text numberOfLines={3} className="mt-2 text-lg font-semibold text-primary">
              {bet.title}
            </Text>

            <View className="mt-2.5 flex-row items-center gap-4">
              <View className="flex-row items-baseline gap-1.5">
                <Money agorot={bet.total_pot_agorot} size="sm" tone="accent" />
                <Text className="text-sm text-secondary">pot</Text>
              </View>

              {countdown && (
                <View className="flex-row items-center gap-1.5">
                  <ClockIcon size={13} color={colors.textSecondary} />
                  <Text style={tabular} className="text-sm text-secondary">
                    {countdown.replace('Closes in ', '')}
                  </Text>
                </View>
              )}
            </View>

            <View className="mt-4">
              <OddsBar
                countA={counts.a}
                countB={counts.b}
                labelA={bet.option_a_label}
                labelB={bet.option_b_label}
                winningOption={isResolved ? bet.winning_option : null}
                size="sm"
              />
            </View>
          </View>

          {side && !isResolved && !isCancelled && (
            <View className="flex-row items-center gap-2 border-t border-hairline bg-accent-soft px-4 py-2.5">
              <Text className="text-sm text-accent">
                You&apos;re on <Text className="font-semibold">{myLabel}</Text>
              </Text>
            </View>
          )}

          {isResolved && side && (
            <View
              className={`flex-row items-center justify-between gap-2 border-t border-hairline px-4 py-2.5 ${
                iWon ? 'bg-positive-soft' : 'bg-negative-soft'
              }`}
            >
              <Text className={`text-sm font-semibold ${iWon ? 'text-positive' : 'text-negative'}`}>
                {iWon ? 'You won' : 'You lost'}
              </Text>
              <Text className="text-sm text-secondary">{winningLabel} took it</Text>
            </View>
          )}
        </PressableScale>
      </Link>
    </Animated.View>
  );
}
