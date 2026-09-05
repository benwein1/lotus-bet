import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from '@/components/animated';

import { countSides, mySide } from '@/components/bet-card';
import { BetMediaView } from '@/components/bet-media';
import { AlertIcon, ClockIcon, LockIcon, TrophyIcon } from '@/components/icons';
import { OddsBar } from '@/components/odds-bar';
import { ContentWidth, Screen } from '@/components/screen';
import {
  Avatar,
  Badge,
  Button,
  ErrorNotice,
  Loading,
  Money,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetSide, BetWithPositions, UserRow } from '@/lib/database.types';
import { formatAgorot, formatCountdown, formatShortDate } from '@/lib/format';
import { previewShareAgorot } from '@/lib/payout';
import {
  cancelBet,
  fetchBet,
  fetchBetLedger,
  fetchGroup,
  joinBet,
  leaveBet,
  lockBet,
  resolveBet,
} from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function BetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const betId = id ?? '';
  const { session } = useAuth();
  const colors = useColors();
  const userId = session?.user.id ?? '';

  const bet = useAsync(() => fetchBet(betId), [betId]);
  const groupId = bet.data?.group_id;
  const group = useAsync(
    () => (groupId ? fetchGroup(groupId) : Promise.resolve(null)),
    [groupId]
  );
  // Only resolved bets have ledger rows; skip the round-trip otherwise.
  const ledger = useAsync(
    () => (bet.data?.status === 'resolved' ? fetchBetLedger(betId) : Promise.resolve([])),
    [betId, bet.data?.status]
  );

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // See the note in group/[id]/index.tsx: depend on the stable `reload`, not
  // on the state object, or the Realtime channel reopens every render.
  const { reload: reloadBet } = bet;

  const refresh = useCallback(() => {
    void reloadBet({ silent: true });
  }, [reloadBet]);

  useGroupRealtime(groupId, refresh);

  // Same reason as the group screen: this one is still mounted under the
  // settle-up screen, so a balance settled there would otherwise be stale on
  // the way back.
  useFocusEffect(refresh);

  if (bet.loading) return <Loading label="Loading bet…" />;
  if (!bet.data) {
    return (
      <Screen className="px-gutter pt-10">
        <ErrorNotice message={bet.error ?? 'This bet is not available.'} />
      </Screen>
    );
  }

  const data = bet.data;
  const counts = countSides(data);
  const side = mySide(data, userId);
  const isCreator = data.creator_id === userId;
  const countdown = formatCountdown(data.close_at);
  const deadlinePassed = countdown === 'Closed';
  const canJoin = data.status === 'open' && !deadlinePassed;
  const isResolved = data.status === 'resolved';
  const isCancelled = data.status === 'cancelled';
  const media = data.media ?? [];

  const myLedgerAmount =
    (ledger.data ?? []).find((entry) => entry.user_id === userId)?.amount_agorot ?? null;

  const usersById = new Map<string, UserRow>(
    (group.data?.members ?? []).map((m) => [m.user_id, m.user])
  );

  async function withBusy(action: () => Promise<void>) {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      await bet.reload({ silent: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function pickSide(next: BetSide) {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await withBusy(async () => {
      // Tapping the side you're already on withdraws you from the bet.
      if (side === next) await leaveBet(betId);
      else await joinBet(betId, next);
    });
  }

  function confirmResolve(winning: BetSide) {
    const label = winning === 'a' ? data.option_a_label : data.option_b_label;
    const winners = winning === 'a' ? counts.a : counts.b;

    Alert.alert(
      `"${label}" won?`,
      winners === 0
        ? 'Nobody backed that side, so nothing will change hands. This cannot be undone.'
        : `${winners} ${winners === 1 ? 'person splits' : 'people split'} ${formatAgorot(data.total_pot_agorot)}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          style: 'destructive',
          onPress: () =>
            void withBusy(async () => {
              await resolveBet(betId, winning);
              if (Platform.OS !== 'web') {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }),
        },
      ]
    );
  }

  function confirmCancel() {
    Alert.alert('Cancel this bet?', 'Nobody wins, nobody owes anything.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel bet',
        style: 'destructive',
        onPress: () => void withBusy(() => cancelBet(betId)),
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: data.group?.name ?? 'Bet' }} />
      <Screen ground="sunken">
        <ScrollView
          contentContainerClassName="px-gutter pb-12 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={bet.refreshing}
              onRefresh={() => bet.reload()}
              tintColor={colors.textTertiary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            {media.length > 0 && (
              <Animated.View entering={FadeIn.duration(motion.duration.base)} className="mb-5">
                <BetMediaView media={media} active radius={24} className="h-72 w-full" />
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <View className="mb-3 flex-row items-center gap-2.5">
                <Badge label={data.status} tone={data.status} />
                {countdown && !isResolved && !isCancelled && (
                  <View className="flex-row items-center gap-1.5">
                    <ClockIcon size={13} color={colors.textSecondary} />
                    <Text className="text-sm text-secondary">{countdown}</Text>
                  </View>
                )}
                <Text className="ml-auto text-sm text-tertiary">
                  {formatShortDate(data.created_at)}
                </Text>
              </View>

              <Text className="text-2xl font-bold text-primary">{data.title}</Text>
              {data.description && (
                <Text className="mt-2.5 text-base leading-[22px] text-secondary">
                  {data.description}
                </Text>
              )}
            </Animated.View>

            {/* The market */}
            <Animated.View
              entering={FadeInDown.delay(60).duration(motion.duration.base)}
              className="mt-5"
            >
              <View className="rounded-3xl border border-hairline bg-surface p-4">
                <View className="mb-5 flex-row items-end justify-between">
                  <Text className="text-subhead text-secondary">Total pot</Text>
                  <Money agorot={data.total_pot_agorot} size="lg" tone="accent" />
                </View>
                <OddsBar
                  countA={counts.a}
                  countB={counts.b}
                  labelA={data.option_a_label}
                  labelB={data.option_b_label}
                  winningOption={isResolved ? data.winning_option : null}
                  size="lg"
                />
              </View>
            </Animated.View>

            {actionError && (
              <View className="mt-4">
                <ErrorNotice message={actionError} />
              </View>
            )}

            {/* Pick a side */}
            {canJoin && (
              <Animated.View
                entering={FadeInDown.delay(120).duration(motion.duration.base)}
                className="mt-4 flex-row gap-3"
              >
                <SideButton
                  label={data.option_a_label}
                  tone="a"
                  selected={side === 'a'}
                  disabled={busy}
                  // Joining makes the side one bigger, so preview against n+1.
                  shareAgorot={previewShareAgorot(
                    data.total_pot_agorot,
                    side === 'a' ? counts.a : counts.a + 1
                  )}
                  onPress={() => void pickSide('a')}
                />
                <SideButton
                  label={data.option_b_label}
                  tone="b"
                  selected={side === 'b'}
                  disabled={busy}
                  shareAgorot={previewShareAgorot(
                    data.total_pot_agorot,
                    side === 'b' ? counts.b : counts.b + 1
                  )}
                  onPress={() => void pickSide('b')}
                />
              </Animated.View>
            )}

            {!canJoin && !isResolved && !isCancelled && (
              <View className="mt-4 flex-row items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3.5">
                <LockIcon size={17} color={colors.textSecondary} />
                <Text className="flex-1 text-subhead leading-5 text-secondary">
                  {deadlinePassed
                    ? 'The join deadline has passed — waiting on the creator to call it.'
                    : 'This bet is locked. No more joining.'}
                </Text>
              </View>
            )}

            {isCancelled && (
              <View className="mt-4 flex-row items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3.5">
                <AlertIcon size={17} color={colors.textSecondary} />
                <Text className="flex-1 text-subhead text-secondary">
                  This bet was cancelled. Nobody won and nobody owes anything.
                </Text>
              </View>
            )}

            {isResolved && (
              <ResolvedSummary bet={data} userId={userId} myAmountAgorot={myLedgerAmount} />
            )}

            {/* Who's in */}
            <View className="mt-7">
              <SectionTitle>Who&apos;s in</SectionTitle>
              <View className="flex-row gap-3">
                <SideRoster
                  label={data.option_a_label}
                  tone="a"
                  won={isResolved ? data.winning_option === 'a' : null}
                  people={(data.positions ?? [])
                    .filter((p) => p.side === 'a')
                    .map((p) => ({
                      id: p.user_id,
                      name: usersById.get(p.user_id)?.display_name ?? 'Someone',
                    }))}
                />
                <SideRoster
                  label={data.option_b_label}
                  tone="b"
                  won={isResolved ? data.winning_option === 'b' : null}
                  people={(data.positions ?? [])
                    .filter((p) => p.side === 'b')
                    .map((p) => ({
                      id: p.user_id,
                      name: usersById.get(p.user_id)?.display_name ?? 'Someone',
                    }))}
                />
              </View>
            </View>

            {/* Creator controls */}
            {isCreator && !isResolved && !isCancelled && (
              <View className="mt-7">
                <SectionTitle>You created this bet</SectionTitle>
                <View className="rounded-3xl border border-hairline bg-surface p-4">
                  <Text className="mb-4 text-sm leading-[18px] text-secondary">
                    Only you can call it. Bets can&apos;t be edited — only locked, resolved or
                    cancelled.
                  </Text>
                  <View className="gap-3">
                    <Button
                      title={`"${data.option_a_label}" won`}
                      variant="secondary"
                      disabled={busy}
                      icon={<TrophyIcon size={16} color={colors.text} />}
                      onPress={() => confirmResolve('a')}
                    />
                    <Button
                      title={`"${data.option_b_label}" won`}
                      variant="secondary"
                      disabled={busy}
                      icon={<TrophyIcon size={16} color={colors.text} />}
                      onPress={() => confirmResolve('b')}
                    />
                    {data.status === 'open' && (
                      <Button
                        title="Lock — no more joining"
                        variant="plain"
                        disabled={busy}
                        icon={<LockIcon size={16} color={colors.accent} />}
                        onPress={() => void withBusy(() => lockBet(betId))}
                      />
                    )}
                    <Button
                      title="Cancel bet"
                      variant="destructive"
                      disabled={busy}
                      onPress={confirmCancel}
                    />
                  </View>
                </View>
              </View>
            )}
          </ContentWidth>
        </ScrollView>
      </Screen>
    </>
  );
}

function SideButton({
  label,
  tone,
  selected,
  disabled,
  shareAgorot,
  onPress,
}: {
  label: string;
  tone: 'a' | 'b';
  selected: boolean;
  disabled: boolean;
  shareAgorot: number;
  onPress: () => void;
}) {
  // Tailwind class names have to be literal for the compiler to see them, so
  // the two tones are spelled out rather than interpolated.
  const container = selected
    ? tone === 'a'
      ? 'border-sideA bg-sideA-soft'
      : 'border-sideB bg-sideB-soft'
    : 'border-hairline bg-surface';
  const labelColor = selected ? (tone === 'a' ? 'text-sideA' : 'text-sideB') : 'text-primary';

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.955}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      className={`flex-1 rounded-3xl border-2 px-4 py-4 ${container} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <Text numberOfLines={2} className={`text-base font-semibold ${labelColor}`}>
        {label}
      </Text>
      <Text className="mt-1.5 text-sm text-secondary">
        {selected ? 'Tap to withdraw' : `Win ~${formatAgorot(shareAgorot)}`}
      </Text>
    </PressableScale>
  );
}

function SideRoster({
  label,
  tone,
  won,
  people,
}: {
  label: string;
  tone: 'a' | 'b';
  /** null while unresolved; true/false once a winner is declared. */
  won: boolean | null;
  people: { id: string; name: string }[];
}) {
  const colors = useColors();
  const dimmed = won === false;
  const labelColor = dimmed ? 'text-tertiary' : tone === 'a' ? 'text-sideA' : 'text-sideB';

  return (
    <View
      className={`flex-1 rounded-3xl border bg-surface p-4 ${
        won === true ? 'border-positive' : 'border-hairline'
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      <View className="mb-3 flex-row items-center gap-1.5">
        <Text numberOfLines={1} className={`flex-1 text-subhead font-semibold ${labelColor}`}>
          {label}
        </Text>
        {won === true && <TrophyIcon size={14} color={colors.positive} />}
      </View>

      {people.length === 0 ? (
        <Text className="text-sm text-tertiary">Nobody yet</Text>
      ) : (
        people.map((person, index) => (
          <View key={`${person.id}-${index}`} className="mb-2 flex-row items-center gap-2">
            <Avatar name={person.name} id={person.id} size={24} />
            <Text numberOfLines={1} className="flex-1 text-sm text-primary">
              {person.name}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

/**
 * The payoff moment. A bet resolving is the emotional peak of the app, so it
 * gets a real entrance rather than a quiet re-render — the one place in the
 * product where a spring is allowed to overshoot.
 */
function ResolvedSummary({
  bet,
  userId,
  myAmountAgorot,
}: {
  bet: BetWithPositions;
  userId: string;
  /** The signed ledger line the resolve-bet function wrote for this user. */
  myAmountAgorot: number | null;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const counts = countSides(bet);
  const side = mySide(bet, userId);
  const winners = bet.winning_option === 'a' ? counts.a : counts.b;
  const winningLabel = bet.winning_option === 'a' ? bet.option_a_label : bet.option_b_label;

  if (winners === 0) {
    return (
      <Animated.View entering={FadeIn.delay(120).duration(motion.duration.slow)} className="mt-4">
        <View className="flex-row items-center gap-3 rounded-3xl border border-hairline bg-surface px-4 py-4">
          <AlertIcon size={18} color={colors.textSecondary} />
          <View className="flex-1">
            <Text className="text-subhead font-semibold text-primary">
              {winningLabel} won — but nobody backed it.
            </Text>
            <Text className="mt-0.5 text-sm text-secondary">
              No money changes hands on this one.
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  const iWon = side !== null && side === bet.winning_option;
  const watchedOnly = side === null;

  return (
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : ZoomIn.delay(140)
              .springify()
              .duration(motion.celebrate.duration)
              .dampingRatio(motion.celebrate.dampingRatio)
      }
      className="mt-4"
    >
      <View
        className={`items-center rounded-3xl border px-5 py-6 ${
          watchedOnly
            ? 'border-hairline bg-surface'
            : iWon
              ? 'border-positive bg-positive-soft'
              : 'border-negative bg-negative-soft'
        }`}
      >
        {!watchedOnly && (
          <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-surface">
            <TrophyIcon size={22} color={iWon ? colors.positive : colors.negative} />
          </View>
        )}

        <Text className="text-subhead text-secondary">
          <Text className="font-semibold text-primary">{winningLabel}</Text> took it
        </Text>

        {side !== null && myAmountAgorot !== null && (
          <View className="mt-1.5">
            <Money agorot={myAmountAgorot} size="xl" sign />
          </View>
        )}

        <Text className="mt-2 text-center text-sm leading-[18px] text-secondary">
          {watchedOnly
            ? 'You sat this one out.'
            : 'Settle it on the group’s settle-up screen when you’re ready.'}
        </Text>
      </View>
    </Animated.View>
  );
}
