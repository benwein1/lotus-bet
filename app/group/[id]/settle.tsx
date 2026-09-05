import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from '@/components/animated';

import { CheckIcon, HandshakeIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { SettleSkeleton } from '@/components/skeletons';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorNotice,
  Money,
  SectionTitle,
} from '@/components/ui';
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
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

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
  const colors = useColors();
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

  return (
    <Screen ground="sunken">
      <ScrollView
        contentContainerClassName="px-gutter pb-12 pt-3"
        refreshControl={
          <RefreshControl
            refreshing={balances.refreshing}
            onRefresh={refresh}
            tintColor={colors.textTertiary}
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
                <View className="mb-8 items-center rounded-3xl border border-hairline bg-surface px-5 py-8">
                  <Text className="text-sm text-secondary">Your net position</Text>
                  {myBalance === 0 ? (
                    <Text className="mt-2 text-4xl font-bold text-primary">Square</Text>
                  ) : (
                    <View className="mt-2">
                      <Money agorot={myBalance} size="hero" sign />
                    </View>
                  )}
                  <Text className="mt-3 max-w-[280px] text-center text-subhead leading-5 text-secondary">
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

              <View className="mb-8">
                <SectionTitle>Suggested payments</SectionTitle>
              {settlement.transactions.length === 0 ? (
                <View className="rounded-3xl border border-hairline bg-surface">
                  <EmptyState
                    icon={<HandshakeIcon size={26} color={colors.textSecondary} />}
                    title="Everyone's square"
                    body="No outstanding balances in this group. Resolve a bet and they'll show up here."
                  />
                </View>
              ) : (
                <View>
                  <Text className="mb-3 px-1 text-sm leading-[18px] text-secondary">
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
                        <View
                          className={`mb-2.5 rounded-3xl border border-hairline bg-surface p-4 ${
                            involvesMe ? '' : 'opacity-55'
                          }`}
                        >
                          <View className="flex-row items-center gap-3">
                            <Avatar name={fromName} id={txn.fromUserId} size={34} />
                            <View className="flex-1">
                              <Text className="text-sm text-secondary">
                                {iPay ? 'You pay' : `${fromName} pays`}{' '}
                                <Text className="text-primary">
                                  {txn.toUserId === userId ? 'you' : toName}
                                </Text>
                              </Text>
                              <View className="mt-0.5">
                                <Money
                                  agorot={txn.amountAgorot}
                                  size="md"
                                  tone={iPay ? 'negative' : involvesMe ? 'positive' : 'neutral'}
                                />
                              </View>
                            </View>

                            <Button
                              title={pendingKey === key ? 'Saving' : 'Paid'}
                              size="sm"
                              variant={involvesMe ? 'tinted' : 'secondary'}
                              loading={pendingKey === key}
                              disabled={!involvesMe}
                              icon={
                                pendingKey === key ? undefined : (
                                  <CheckIcon
                                    size={15}
                                    color={involvesMe ? colors.accent : colors.textTertiary}
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
              </View>

              <View>
                <SectionTitle>Everyone&apos;s balance</SectionTitle>
                <View className="overflow-hidden rounded-3xl border border-hairline bg-surface px-4">
                  {settlement.balances.map((balance, i) => (
                    <View
                      key={balance.userId}
                      className={`flex-row items-center gap-3 py-3 ${
                        i === settlement.balances.length - 1 ? '' : 'border-b border-hairline'
                      }`}
                    >
                      <Avatar
                        name={balance.user?.display_name ?? '?'}
                        id={balance.userId}
                        size={32}
                      />
                      <Text className="flex-1 text-base text-primary">
                        {balance.user?.display_name ?? 'Unknown'}
                        {balance.userId === userId && <Text className="text-secondary"> (you)</Text>}
                      </Text>
                      <Text
                        className={`text-subhead font-semibold ${
                          balance.amountAgorot > 0
                            ? 'text-positive'
                            : balance.amountAgorot < 0
                              ? 'text-negative'
                              : 'text-tertiary'
                        }`}
                      >
                        {balance.amountAgorot === 0
                          ? 'square'
                          : formatAgorot(balance.amountAgorot, { sign: true })}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <Text className="mt-8 text-center text-xs leading-4 text-tertiary">
                Lotus Bet never moves money. Marking a payment as paid only updates the running
                total here.
              </Text>
            </>
          )}
        </ContentWidth>
      </ScrollView>
    </Screen>
  );
}
