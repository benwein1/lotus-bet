import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from '@/components/animated';

import { countSides, mySide } from '@/components/bet-card';
import { AlertIcon, ClockIcon, LockIcon, TrophyIcon } from '@/components/icons';
import { OddsBar } from '@/components/odds-bar';
import { ContentWidth, ScreenBackdrop } from '@/components/screen';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  ErrorNotice,
  Loading,
  Overline,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
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
import { colors, elevation, motion } from '@/theme';

export default function BetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const betId = id ?? '';
  const { session } = useAuth();
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

  if (bet.loading) return <Loading label="Loading bet…" />;
  if (!bet.data) {
    return (
      <View className="flex-1 bg-ink-950 px-gutter pt-10">
        <ErrorNotice message={bet.error ?? 'This bet is not available.'} />
      </View>
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
      <View className="flex-1 bg-ink-950">
        <ScreenBackdrop
          tint={
            isResolved
              ? side === data.winning_option
                ? colors.sideA.DEFAULT
                : colors.owing.DEFAULT
              : colors.lotus['600']
          }
        />
        <ScrollView
          contentContainerClassName="px-gutter pb-12 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={bet.refreshing}
              onRefresh={() => bet.reload()}
              tintColor={colors.lotus['400']}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <View className="mb-3.5 flex-row items-center gap-2.5">
                <Badge label={data.status} tone={data.status} />
                {countdown && !isResolved && !isCancelled && (
                  <View className="flex-row items-center gap-1.5">
                    <ClockIcon size={13} color={colors.ink['600']} />
                    <Text className="text-xs text-ink-600">{countdown}</Text>
                  </View>
                )}
                <Text className="ml-auto text-xs text-ink-650">
                  {formatShortDate(data.created_at)}
                </Text>
              </View>

              <Text className="font-display-bold text-2xl leading-8 text-ink-50">{data.title}</Text>
              {data.description && (
                <Text className="mt-3 text-base leading-6 text-ink-600">{data.description}</Text>
              )}
            </Animated.View>

            {/* The market */}
            <Animated.View
              entering={FadeInDown.delay(60).duration(motion.duration.base)}
              className="mt-6"
            >
              <Card level="raised">
                <View className="mb-5 flex-row items-center justify-between">
                  <Overline>Total pot</Overline>
                  <Text className="font-display-bold text-3xl text-lotus-300">
                    {formatAgorot(data.total_pot_agorot)}
                  </Text>
                </View>
                <OddsBar
                  countA={counts.a}
                  countB={counts.b}
                  labelA={data.option_a_label}
                  labelB={data.option_b_label}
                  winningOption={isResolved ? data.winning_option : null}
                  size="lg"
                />
              </Card>
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
                className="mt-5 flex-row gap-3"
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
              <View className="mt-5 flex-row items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-3.5">
                <LockIcon size={17} color={colors.ink['600']} />
                <Text className="flex-1 text-sm leading-5 text-ink-600">
                  {deadlinePassed
                    ? 'The join deadline has passed — waiting on the creator to call it.'
                    : 'This bet is locked. No more joining.'}
                </Text>
              </View>
            )}

            {isCancelled && (
              <View className="mt-5 flex-row items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-3.5">
                <AlertIcon size={17} color={colors.ink['600']} />
                <Text className="flex-1 text-sm text-ink-600">
                  This bet was cancelled. Nobody won and nobody owes anything.
                </Text>
              </View>
            )}

            {isResolved && (
              <ResolvedSummary bet={data} userId={userId} myAmountAgorot={myLedgerAmount} />
            )}

            {/* Who's in */}
            <View className="mt-8">
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
              <View className="mt-8">
                <SectionTitle>You created this bet</SectionTitle>
                <Card padded={false} className="overflow-hidden">
                  <Text className="px-5 pb-4 pt-4 text-xs leading-5 text-ink-600">
                    Only you can call it. Bets can&apos;t be edited — only locked, resolved or
                    cancelled.
                  </Text>
                  <Divider />
                  <View className="gap-3 p-4">
                    <Button
                      title={`"${data.option_a_label}" won`}
                      variant="secondary"
                      disabled={busy}
                      icon={<TrophyIcon size={16} color={colors.ink['50']} />}
                      onPress={() => confirmResolve('a')}
                    />
                    <Button
                      title={`"${data.option_b_label}" won`}
                      variant="secondary"
                      disabled={busy}
                      icon={<TrophyIcon size={16} color={colors.ink['50']} />}
                      onPress={() => confirmResolve('b')}
                    />
                    {data.status === 'open' && (
                      <Button
                        title="Lock — no more joining"
                        variant="ghost"
                        disabled={busy}
                        icon={<LockIcon size={16} color={colors.ink['500']} />}
                        onPress={() => void withBusy(() => lockBet(betId))}
                      />
                    )}
                    <Button
                      title="Cancel bet"
                      variant="danger"
                      disabled={busy}
                      onPress={confirmCancel}
                    />
                  </View>
                </Card>
              </View>
            )}
          </ContentWidth>
        </ScrollView>
      </View>
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
      ? 'border-sideA bg-sideA-shade'
      : 'border-sideB bg-sideB-shade'
    : 'border-ink-750 bg-ink-900';
  const labelColor = selected ? (tone === 'a' ? 'text-sideA' : 'text-sideB') : 'text-ink-50';

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.955}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={selected ? elevation.glow(tone === 'a' ? colors.sideA.deep : colors.sideB.deep) : undefined}
      className={`flex-1 rounded-3xl border-2 px-4 py-4 ${container} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text numberOfLines={2} className={`font-display text-base leading-5 ${labelColor}`}>
        {label}
      </Text>
      <Text className="mt-2 text-xs text-ink-600">
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
  const dimmed = won === false;
  const labelColor = dimmed ? 'text-ink-650' : tone === 'a' ? 'text-sideA' : 'text-sideB';

  return (
    <View
      className={`flex-1 rounded-3xl border bg-ink-900 p-4 ${
        won === true ? 'border-owed/35' : 'border-ink-800'
      }`}
    >
      <View className="mb-3 flex-row items-center gap-1.5">
        <Text numberOfLines={1} className={`flex-1 font-display text-sm ${labelColor}`}>
          {label}
        </Text>
        {won === true && <TrophyIcon size={14} color={colors.owed.DEFAULT} />}
      </View>

      {people.length === 0 ? (
        <Text className="text-xs text-ink-650">Nobody yet</Text>
      ) : (
        people.map((person, index) => (
          <View key={`${person.id}-${index}`} className="mb-2 flex-row items-center gap-2">
            <Avatar name={person.name} id={person.id} size={24} />
            <Text numberOfLines={1} className={`flex-1 text-xs ${dimmed ? 'text-ink-600' : 'text-ink-400'}`}>
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
 * gets a real entrance rather than a quiet re-render.
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
  const counts = countSides(bet);
  const side = mySide(bet, userId);
  const winners = bet.winning_option === 'a' ? counts.a : counts.b;
  const winningLabel = bet.winning_option === 'a' ? bet.option_a_label : bet.option_b_label;

  if (winners === 0) {
    return (
      <Animated.View entering={FadeIn.delay(120).duration(motion.duration.slow)} className="mt-5">
        <View className="flex-row items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-4">
          <AlertIcon size={18} color={colors.ink['600']} />
          <View className="flex-1">
            <Text className="font-display text-sm text-ink-50">
              {winningLabel} won — but nobody backed it.
            </Text>
            <Text className="mt-1 text-xs text-ink-600">No money changes hands on this one.</Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  const iWon = side !== null && side === bet.winning_option;
  const watchedOnly = side === null;

  return (
    <Animated.View
      entering={ZoomIn.delay(140).springify().damping(motion.celebrate.damping).stiffness(
        motion.celebrate.stiffness
      )}
      className="mt-5"
    >
      <View
        className={`items-center rounded-3xl border px-5 py-6 ${
          watchedOnly
            ? 'border-ink-800 bg-ink-900'
            : iWon
              ? 'border-owed/35 bg-owed-shade'
              : 'border-owing/35 bg-owing-shade'
        }`}
      >
        {!watchedOnly && (
          <View
            className={`mb-3 h-12 w-12 items-center justify-center rounded-2xl ${
              iWon ? 'bg-owed/15' : 'bg-owing/15'
            }`}
          >
            <TrophyIcon
              size={22}
              color={iWon ? colors.owed.DEFAULT : colors.owing.DEFAULT}
            />
          </View>
        )}

        <Text className="font-display text-sm text-ink-500">
          <Text className="text-ink-50">{winningLabel}</Text> took it
        </Text>

        {side !== null && myAmountAgorot !== null && (
          <Text
            className={`mt-1.5 font-display-bold text-4xl ${iWon ? 'text-owed' : 'text-owing'}`}
          >
            {iWon
              ? formatAgorot(myAmountAgorot, { sign: true })
              : formatAgorot(myAmountAgorot, { sign: true })}
          </Text>
        )}

        <Text className="mt-2.5 text-center text-xs leading-5 text-ink-600">
          {watchedOnly
            ? 'You sat this one out.'
            : 'Settle it on the group’s settle-up screen when you’re ready.'}
        </Text>
      </View>
    </Animated.View>
  );
}
