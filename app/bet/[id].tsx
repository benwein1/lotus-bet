import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from '@/components/animated';

import { betSlices, myOptionId, winningLabel } from '@/components/bet-card';
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
  useConfirm,
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
  joinBetOption,
  leaveBet,
  lockBet,
  resolveBet,
} from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors, useScheme } from '@/providers/theme-provider';
import { motion, optionColor } from '@/theme';

export default function BetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const betId = id ?? '';
  const { session } = useAuth();
  const colors = useColors();
  const router = useRouter();
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
  const { ask, dialog } = useConfirm();

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
        <Button
          title="Back to the feed"
          variant="tinted"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        />
      </Screen>
    );
  }

  const data = bet.data;
  const slices = betSlices(data);
  const picked = myOptionId(data, userId);
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

  async function pickOption(next: string) {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await withBusy(async () => {
      // Tapping the option you're already on withdraws you from the bet.
      if (picked === next) await leaveBet(betId);
      else await joinBetOption(betId, next);
    });
  }

  function confirmResolve(optionId: string) {
    const slice = slices.find((s) => s.id === optionId);
    const label = slice?.label ?? 'That option';
    const winners = slice?.count ?? 0;

    ask({
      title: `"${label}" won?`,
      message:
        winners === 0
          ? 'Nobody backed that side, so nothing will change hands. This cannot be undone.'
          : `${winners} ${winners === 1 ? 'person splits' : 'people split'} ${formatAgorot(data.total_pot_agorot)}. This cannot be undone.`,
      confirmLabel: 'Resolve',
      destructive: true,
      onConfirm: () =>
        void withBusy(async () => {
          await resolveBet(betId, optionId);
          if (Platform.OS !== 'web') {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }),
    });
  }

  function confirmCancel() {
    ask({
      title: 'Cancel this bet?',
      message: 'Nobody wins, nobody owes anything.',
      cancelLabel: 'Keep it',
      confirmLabel: 'Cancel bet',
      destructive: true,
      onConfirm: () => void withBusy(() => cancelBet(betId)),
    });
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
                  slices={slices}
                  winningId={isResolved ? data.winning_option_id ?? null : null}
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
                className="mt-4 flex-row flex-wrap gap-3"
              >
                {slices.map((slice, index) => (
                  <OptionButton
                    key={slice.id}
                    label={slice.label}
                    index={index}
                    count={slices.length}
                    selected={picked === slice.id}
                    disabled={busy}
                    // Joining makes that option one bigger, so preview against
                    // n+1 unless you are already on it.
                    shareAgorot={previewShareAgorot(
                      data.total_pot_agorot,
                      picked === slice.id ? slice.count : slice.count + 1
                    )}
                    onPress={() => void pickOption(slice.id)}
                  />
                ))}
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
              <View className="flex-row flex-wrap gap-3">
                {slices.map((slice, index) => (
                  <OptionRoster
                    key={slice.id}
                    label={slice.label}
                    index={index}
                    count={slices.length}
                    won={isResolved ? data.winning_option_id === slice.id : null}
                    people={(data.positions ?? [])
                      .filter((p) => p.option_id === slice.id)
                      .map((p) => ({
                        id: p.user_id,
                        name: usersById.get(p.user_id)?.display_name ?? 'Someone',
                        avatarUrl: usersById.get(p.user_id)?.avatar_url ?? null,
                      }))}
                  />
                ))}
              </View>
            </View>

            {isCreator && !isResolved && !isCancelled && (
              <View className="mt-7">
                <SectionTitle>You created this bet</SectionTitle>
                <View className="rounded-3xl border border-hairline bg-surface p-4">
                  <Text className="mb-4 text-sm leading-[18px] text-secondary">
                    Only you can call it. Bets can&apos;t be edited — only locked, resolved or
                    cancelled.
                  </Text>
                  <View className="gap-3">
                    {slices.map((slice) => (
                      <Button
                        key={slice.id}
                        title={`"${slice.label}" won`}
                        variant="secondary"
                        disabled={busy}
                        icon={<TrophyIcon size={16} color={colors.text} />}
                        onPress={() => confirmResolve(slice.id)}
                      />
                    ))}
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
        {dialog}
      </Screen>
    </>
  );
}

function OptionButton({
  label,
  index,
  count,
  selected,
  disabled,
  shareAgorot,
  onPress,
}: {
  label: string;
  index: number;
  count: number;
  selected: boolean;
  disabled: boolean;
  shareAgorot: number;
  onPress: () => void;
}) {
  const scheme = useScheme();
  // With an arbitrary number of options there is no literal class name to
  // write, so the colour is an inline style. Tailwind cannot see an
  // interpolated class — see §4.
  const color = optionColor(index, count, scheme);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.955}
      accessibilityRole="button"
      accessibilityLabel={selected ? `Withdraw from ${label}` : `Back ${label}`}
      accessibilityState={{ selected, disabled }}
      style={{
        borderColor: selected ? color : undefined,
        // Two fill the row; three or more take half and wrap.
        flexBasis: count === 2 ? 0 : '47%',
        flexGrow: 1,
      }}
      className={`rounded-3xl border-2 px-4 py-4 ${
        selected ? '' : 'border-hairline bg-surface'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Text
        numberOfLines={2}
        style={selected ? { color } : undefined}
        className={`text-base font-semibold ${selected ? '' : 'text-primary'}`}
      >
        {label}
      </Text>
      <Text className="mt-1.5 text-sm text-secondary">
        {selected ? 'Tap to withdraw' : `Win ~${formatAgorot(shareAgorot)}`}
      </Text>
    </PressableScale>
  );
}

function OptionRoster({
  label,
  index,
  count,
  won,
  people,
}: {
  label: string;
  index: number;
  count: number;
  /** null while unresolved; true/false once a winner is declared. */
  won: boolean | null;
  people: { id: string; name: string; avatarUrl?: string | null }[];
}) {
  const colors = useColors();
  const scheme = useScheme();
  const dimmed = won === false;
  const color = optionColor(index, count, scheme);

  return (
    <View
      style={{ flexBasis: count === 2 ? 0 : '47%', flexGrow: 1 }}
      className={`rounded-3xl border bg-surface p-4 ${
        won === true ? 'border-positive' : 'border-hairline'
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      <View className="mb-3 flex-row items-center gap-1.5">
        <Text
          numberOfLines={1}
          style={dimmed ? undefined : { color }}
          className={`flex-1 text-subhead font-semibold ${dimmed ? 'text-tertiary' : ''}`}
        >
          {label}
        </Text>
        {won === true && <TrophyIcon size={14} color={colors.positive} />}
      </View>

      {people.length === 0 ? (
        <Text className="text-sm text-tertiary">Nobody yet</Text>
      ) : (
        people.map((person, personIndex) => (
          <View key={`${person.id}-${personIndex}`} className="mb-2 flex-row items-center gap-2">
            <Avatar name={person.name} id={person.id} uri={person.avatarUrl} size={24} />
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
  const slices = betSlices(bet);
  const side = myOptionId(bet, userId);
  const winners = slices.find((s) => s.id === bet.winning_option_id)?.count ?? 0;
  const winner = winningLabel(bet) ?? 'That option';

  if (winners === 0) {
    return (
      <Animated.View entering={FadeIn.delay(120).duration(motion.duration.slow)} className="mt-4">
        <View className="flex-row items-center gap-3 rounded-3xl border border-hairline bg-surface px-4 py-4">
          <AlertIcon size={18} color={colors.textSecondary} />
          <View className="flex-1">
            <Text className="text-subhead font-semibold text-primary">
              {winner} won — but nobody backed it.
            </Text>
            <Text className="mt-0.5 text-sm text-secondary">
              No money changes hands on this one.
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  const iWon = side !== null && side === bet.winning_option_id;
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
          <Animated.View
            entering={
              // The badge lands after the card, and only overshoots on a win.
              // A loss gets the same layout and none of the bounce: animating
              // a defeat like a victory is the kind of thing that makes an app
              // feel like it is not paying attention.
              reduced
                ? FadeIn.duration(motion.duration.fast)
                : iWon
                  ? ZoomIn.delay(260)
                      .springify()
                      .duration(motion.celebrate.duration)
                      .dampingRatio(motion.celebrate.dampingRatio)
                  : FadeIn.delay(220).duration(motion.duration.base)
            }
            className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-surface"
          >
            <TrophyIcon size={26} color={iWon ? colors.positive : colors.negative} />
          </Animated.View>
        )}

        <Text className="text-subhead text-secondary">
          <Text className="font-semibold text-primary">{winner}</Text> took it
        </Text>

        {side !== null && myAmountAgorot !== null && (
          <>
            {/* The number is the payoff of the entire product, so it gets a
                subject and the one animation in the app that overshoots. */}
            <Text
              className={`mt-3 text-sm font-semibold ${
                iWon ? 'text-positive' : 'text-negative'
              }`}
            >
              {iWon ? 'You won' : 'You owe'}
            </Text>
            <Animated.View
              entering={
                reduced
                  ? FadeIn.duration(motion.duration.fast)
                  : iWon
                    ? ZoomIn.delay(340)
                        .springify()
                        .duration(motion.celebrate.duration)
                        .dampingRatio(motion.celebrate.dampingRatio)
                    : FadeInDown.delay(280).duration(motion.duration.base)
              }
              className="mt-0.5"
            >
              <Money agorot={myAmountAgorot} size="xl" sign />
            </Animated.View>
          </>
        )}

        <Text className="mt-3 text-center text-sm leading-[18px] text-secondary">
          {watchedOnly
            ? 'You sat this one out.'
            : 'Settle it on the group’s settle-up screen when you’re ready.'}
        </Text>
      </View>
    </Animated.View>
  );
}
