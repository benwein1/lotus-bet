import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { countSides, mySide } from '@/components/bet-card';
import { OddsBar } from '@/components/odds-bar';
import { Avatar, Badge, Button, Card, ErrorNotice, Loading, SectionTitle } from '@/components/ui';
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
import { colors } from '@/theme';

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
      <View className="flex-1 bg-ink-950 pt-10">
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
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      <ScrollView
        className="flex-1 bg-ink-950"
        contentContainerClassName="px-4 pb-12 pt-4"
        refreshControl={
          <RefreshControl refreshing={bet.refreshing} onRefresh={() => bet.reload()} tintColor={colors.lotus['500']} />
        }
      >
        <View className="mb-4 flex-row items-center gap-2">
          <Badge label={data.status} tone={data.status} />
          {countdown && !isResolved && (
            <Text className="text-xs text-ink-600">{countdown}</Text>
          )}
          <Text className="ml-auto text-xs text-ink-600">
            {formatShortDate(data.created_at)}
          </Text>
        </View>

        <Text className="mb-2 text-2xl font-bold leading-7 text-white">{data.title}</Text>
        {data.description && (
          <Text className="mb-4 text-base leading-6 text-ink-600">{data.description}</Text>
        )}

        <Card className="mb-5">
          <View className="mb-4 flex-row items-baseline justify-between">
            <Text className="text-2xs uppercase tracking-widest text-ink-600">Total pot</Text>
            <Text className="text-2xl font-bold text-lotus-400">
              {formatAgorot(data.total_pot_agorot)}
            </Text>
          </View>

          <OddsBar
            countA={counts.a}
            countB={counts.b}
            labelA={data.option_a_label}
            labelB={data.option_b_label}
            winningOption={isResolved ? data.winning_option : null}
          />
        </Card>

        {actionError && <ErrorNotice message={actionError} />}

        {/* Join / switch sides */}
        {canJoin && (
          <View className="mb-6 flex-row gap-3">
            <SideButton
              label={data.option_a_label}
              tone="a"
              selected={side === 'a'}
              disabled={busy}
              // Joining makes the side one bigger, so preview against n+1.
              shareAgorot={previewShareAgorot(data.total_pot_agorot, side === 'a' ? counts.a : counts.a + 1)}
              onPress={() => void pickSide('a')}
            />
            <SideButton
              label={data.option_b_label}
              tone="b"
              selected={side === 'b'}
              disabled={busy}
              shareAgorot={previewShareAgorot(data.total_pot_agorot, side === 'b' ? counts.b : counts.b + 1)}
              onPress={() => void pickSide('b')}
            />
          </View>
        )}

        {!canJoin && !isResolved && data.status !== 'cancelled' && (
          <View className="mb-6 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3">
            <Text className="text-sm text-ink-600">
              {deadlinePassed
                ? 'The join deadline has passed — waiting on the creator to call it.'
                : 'This bet is locked. No more joining.'}
            </Text>
          </View>
        )}

        {isResolved && (
          <ResolvedSummary bet={data} userId={userId} myAmountAgorot={myLedgerAmount} />
        )}

        {/* Who's on which side */}
        <SectionTitle>Who&apos;s in</SectionTitle>
        <View className="mb-6 flex-row gap-3">
          <SideRoster
            label={data.option_a_label}
            tone="a"
            users={(data.positions ?? [])
              .filter((p) => p.side === 'a')
              .map((p) => usersById.get(p.user_id)?.display_name ?? 'Someone')}
          />
          <SideRoster
            label={data.option_b_label}
            tone="b"
            users={(data.positions ?? [])
              .filter((p) => p.side === 'b')
              .map((p) => usersById.get(p.user_id)?.display_name ?? 'Someone')}
          />
        </View>

        {/* Creator controls */}
        {isCreator && !isResolved && data.status !== 'cancelled' && (
          <View className="gap-3">
            <SectionTitle>You created this bet</SectionTitle>
            <Text className="-mt-2 mb-1 text-xs leading-5 text-ink-600">
              Only you can call it. Bets can&apos;t be edited — only locked, resolved or cancelled.
            </Text>

            <Button
              title={`"${data.option_a_label}" won`}
              variant="secondary"
              disabled={busy}
              onPress={() => confirmResolve('a')}
            />
            <Button
              title={`"${data.option_b_label}" won`}
              variant="secondary"
              disabled={busy}
              onPress={() => confirmResolve('b')}
            />
            {data.status === 'open' && (
              <Button
                title="Lock — no more joining"
                variant="ghost"
                disabled={busy}
                onPress={() => void withBusy(() => lockBet(betId))}
              />
            )}
            <Button title="Cancel bet" variant="danger" disabled={busy} onPress={confirmCancel} />
          </View>
        )}
      </ScrollView>
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
      ? 'border-sideA bg-sideA/15'
      : 'border-sideB bg-sideB/15'
    : 'border-ink-700 bg-ink-900';
  const labelColor = selected ? (tone === 'a' ? 'text-sideA' : 'text-sideB') : 'text-white';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      className={`flex-1 rounded-3xl border-2 px-4 py-4 active:opacity-80 ${container} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <Text numberOfLines={2} className={`text-base font-bold ${labelColor}`}>
        {label}
      </Text>
      <Text className="mt-1 text-xs text-ink-600">
        {selected ? 'Tap to withdraw' : `Win ~${formatAgorot(shareAgorot)}`}
      </Text>
    </Pressable>
  );
}

function SideRoster({
  label,
  tone,
  users,
}: {
  label: string;
  tone: 'a' | 'b';
  users: string[];
}) {
  return (
    <View className="flex-1 rounded-3xl border border-ink-700 bg-ink-900 p-3">
      <Text
        numberOfLines={1}
        className={`mb-2 text-xs font-bold ${tone === 'a' ? 'text-sideA' : 'text-sideB'}`}
      >
        {label}
      </Text>
      {users.length === 0 ? (
        <Text className="text-xs text-ink-600">Nobody yet</Text>
      ) : (
        users.map((name, index) => (
          <View key={`${name}-${index}`} className="mb-1.5 flex-row items-center gap-2">
            <Avatar name={name} size={22} />
            <Text numberOfLines={1} className="flex-1 text-xs text-white">
              {name}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

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
      <View className="mb-6 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3">
        <Text className="text-sm font-semibold text-white">
          {winningLabel} won — but nobody backed it.
        </Text>
        <Text className="mt-1 text-xs text-ink-600">
          No money changes hands on this one.
        </Text>
      </View>
    );
  }

  const iWon = side !== null && side === bet.winning_option;

  return (
    <View
      className={`mb-6 rounded-2xl border px-4 py-3 ${
        side === null
          ? 'border-ink-700 bg-ink-900'
          : iWon
            ? 'border-owed/40 bg-owed/10'
            : 'border-owing/40 bg-owing/10'
      }`}
    >
      <Text className="text-sm font-semibold text-white">{winningLabel} took it.</Text>
      {side !== null && myAmountAgorot !== null && (
        <Text className={`mt-1 text-lg font-bold ${iWon ? 'text-owed' : 'text-owing'}`}>
          {iWon
            ? `You're up ${formatAgorot(myAmountAgorot)}`
            : `You owe ${formatAgorot(Math.abs(myAmountAgorot))}`}
        </Text>
      )}
      <Text className="mt-1 text-xs text-ink-600">
        Settle it on the group&apos;s settle-up screen when you&apos;re ready.
      </Text>
    </View>
  );
}
