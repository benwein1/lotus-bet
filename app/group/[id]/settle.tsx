import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from '@/components/animated';

import { CheckIcon, HandshakeIcon } from '@/components/icons';
import { ContentWidth, ScreenGround } from '@/components/screen';
import { SettleSkeleton } from '@/components/skeletons';
import { Avatar, Button, EmptyState, ErrorNotice, Money, Panel } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { useSettlement } from '@/hooks/use-settlement';
import { formatAgorot } from '@/lib/format';
import {
  confirmSettlement,
  fetchGroup,
  fetchGroupBalances,
  fetchSettlementConfirmations,
} from '@/lib/queries';
import { transactionKey } from '@/lib/settlement';
import { useAuth } from '@/providers/auth-provider';
import { colors, motion } from '@/theme';

/**
 * "Smart Splitwise" for the group.
 *
 * Nothing on this screen is persisted until somebody taps "mark as paid":
 * balances and the suggested payments are recomputed from the ledger every
 * time it opens, which is cheap and cannot drift out of date.
 */
export default function SettleUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const group = useAsync(() => fetchGroup(groupId), [groupId]);
  const balances = useAsync(() => fetchGroupBalances(groupId), [groupId]);
  const confirmations = useAsync(() => fetchSettlementConfirmations(groupId), [groupId]);

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Stable `reload` references — see group/[id]/index.tsx.
  const { reload: reloadBalances } = balances;
  const { reload: reloadConfirmations } = confirmations;

  const refresh = useCallback(() => {
    void reloadBalances({ silent: true });
    void reloadConfirmations({ silent: true });
  }, [reloadBalances, reloadConfirmations]);

  useGroupRealtime(groupId, refresh);

  // `group_balances` already nets confirmed payments in, so nothing extra is
  // layered on here — the second argument is for optimistic rows only.
  const settlement = useSettlement(balances.data, group.data?.members ?? null, [], userId);

  async function markPaid(txn: {
    fromUserId: string;
    toUserId: string;
    amountAgorot: number;
    fromName: string;
    toName: string;
  }) {
    const key = transactionKey(txn);
    setActionError(null);
    setPendingKey(key);
    try {
      await confirmSettlement({
        groupId,
        fromUserId: txn.fromUserId,
        toUserId: txn.toUserId,
        amountAgorot: txn.amountAgorot,
        confirmedBy: userId,
      });
      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record that payment.');
    } finally {
      setPendingKey(null);
    }
  }

  function confirmMarkPaid(txn: {
    fromUserId: string;
    toUserId: string;
    amountAgorot: number;
    fromName: string;
    toName: string;
  }) {
    Alert.alert(
      'Mark as paid?',
      `Records that ${txn.fromName} paid ${txn.toName} ${formatAgorot(txn.amountAgorot)} outside the app. Both balances update.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Mark as paid', onPress: () => void markPaid(txn) },
      ]
    );
  }

  const nameOf = (lookupId: string, fallback = 'Someone') =>
    settlement.balances.find((b) => b.userId === lookupId)?.user?.display_name ?? fallback;

  const myBalance = settlement.myBalanceAgorot;
  const balanceTone = myBalance > 0 ? 'text-owed' : myBalance < 0 ? 'text-owing' : 'text-ink-50';

  return (
    <View className="flex-1 bg-ink-950">
      <ScreenGround
        tint={myBalance > 0 ? colors.owed.DEFAULT : myBalance < 0 ? colors.owing.DEFAULT : colors.ink['700']}
      />
      <ScrollView
        contentContainerClassName="px-gutter pb-12 pt-3"
        refreshControl={
          <RefreshControl
            refreshing={balances.refreshing}
            onRefresh={refresh}
            tintColor={colors.brass['400']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ContentWidth>
          {balances.loading || group.loading ? (
            <SettleSkeleton />
          ) : (
            <>
              <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
                <View className="mb-9 pt-4">
                  <Text className="font-display text-xs text-ink-600">Your net position</Text>
                  {myBalance === 0 ? (
                    <Text className="mt-3 font-display-bold text-6xl text-ink-50">Square</Text>
                  ) : (
                    <View className="mt-3">
                      <Money agorot={myBalance} size="hero" sign />
                    </View>
                  )}
                  <Text className="mt-4 max-w-[280px] text-sm leading-6 text-ink-600">
                    {myBalance > 0
                      ? 'The group owes you this much. Nudge them.'
                      : myBalance < 0
                        ? 'You owe this much. Pay however you normally do, then tick it off.'
                        : 'Nothing outstanding here.'}
                  </Text>
                </View>
              </Animated.View>

              {(balances.error || actionError) && (
                <ErrorNotice message={actionError ?? balances.error ?? ''} />
              )}

              <Panel title="Suggested payments" className="mb-9">
              {settlement.transactions.length === 0 ? (
                    <EmptyState
                      icon={<HandshakeIcon size={26} color={colors.ink['500']} />}
                      title="Everyone's square"
                      body="No outstanding balances in this group. Resolve a bet and they'll show up here."
                    />
              ) : (
                <View>
                  <Text className="mb-4 text-xs leading-5 text-ink-600">
                    The shortest set of payments that clears every balance. Pay each other however
                    you normally do — cash, Bit, bank transfer — then tick it off here.
                  </Text>

                  {settlement.transactions.map((txn, i) => {
                    const key = transactionKey(txn);
                    const fromName = txn.fromUser?.display_name ?? nameOf(txn.fromUserId);
                    const toName = txn.toUser?.display_name ?? nameOf(txn.toUserId);
                    const involvesMe = txn.fromUserId === userId || txn.toUserId === userId;
                    const iPay = txn.fromUserId === userId;

                    return (
                      <Animated.View
                        key={key}
                        entering={FadeInDown.delay(i * motion.stagger).duration(
                          motion.duration.base
                        )}
                      >
                        <View className={involvesMe ? 'py-4' : 'py-4 opacity-55'}>
                          <View className="h-px bg-ink-800" />
                          <View className="mt-4 flex-row items-center gap-3">
                            <Avatar name={fromName} id={txn.fromUserId} size={34} />
                            <View className="flex-1">
                              <Text className="text-xs text-ink-600">
                                {iPay ? 'You pay' : `${fromName} pays`}{' '}
                                <Text className="text-ink-400">
                                  {txn.toUserId === userId ? 'you' : toName}
                                </Text>
                              </Text>
                              <View className="mt-1">
                                <Money
                                  agorot={txn.amountAgorot}
                                  size="lg"
                                  tone={iPay ? 'owing' : involvesMe ? 'owed' : 'neutral'}
                                />
                              </View>
                            </View>

                            <Button
                              title={pendingKey === key ? 'Saving' : 'Paid'}
                              size="sm"
                              variant={involvesMe ? 'success' : 'ghost'}
                              loading={pendingKey === key}
                              disabled={!involvesMe}
                              icon={
                                pendingKey === key ? undefined : (
                                  <CheckIcon
                                    size={15}
                                    color={involvesMe ? colors.owed.DEFAULT : colors.ink['600']}
                                  />
                                )
                              }
                              onPress={() =>
                                confirmMarkPaid({
                                  fromUserId: txn.fromUserId,
                                  toUserId: txn.toUserId,
                                  amountAgorot: txn.amountAgorot,
                                  fromName,
                                  toName,
                                })
                              }
                            />
                          </View>
                        </View>
                      </Animated.View>
                    );
                  })}
                </View>
              )}
              </Panel>

              <Panel title="Everyone's balance">
                <View>
                  {settlement.balances.map((balance, i) => (
                    <View
                      key={balance.userId}
                      className={`flex-row items-center gap-3 py-3 ${
                        i === settlement.balances.length - 1 ? '' : 'border-b border-ink-800'
                      }`}
                    >
                      <Avatar
                        name={balance.user?.display_name ?? '?'}
                        id={balance.userId}
                        size={32}
                      />
                      <Text className="flex-1 text-sm text-ink-50">
                        {balance.user?.display_name ?? 'Unknown'}
                        {balance.userId === userId && <Text className="text-ink-600"> (you)</Text>}
                      </Text>
                      <Text
                        className={`font-display text-sm ${
                          balance.amountAgorot > 0
                            ? 'text-owed'
                            : balance.amountAgorot < 0
                              ? 'text-owing'
                              : 'text-ink-650'
                        }`}
                      >
                        {balance.amountAgorot === 0
                          ? 'square'
                          : formatAgorot(balance.amountAgorot, { sign: true })}
                      </Text>
                    </View>
                  ))}
                </View>
              </Panel>

              <View className="mt-12">
                <View className="h-px w-10 bg-ink-800" />
                <Text className="mt-4 text-xs leading-5 text-ink-650">
                  Lotus Bet never moves money. Marking a payment as paid only updates the running
                  total here.
                </Text>
              </View>
            </>
          )}
        </ContentWidth>
      </ScrollView>
    </View>
  );
}
