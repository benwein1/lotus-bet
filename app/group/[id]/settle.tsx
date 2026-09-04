import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Avatar, Card, EmptyState, ErrorNotice, Loading, SectionTitle } from '@/components/ui';
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
import { colors } from '@/theme';

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

  if (balances.loading || group.loading) return <Loading label="Working out who owes what…" />;

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
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

  const nameOf = (userId2: string, fallback = 'Someone') =>
    settlement.balances.find((b) => b.userId === userId2)?.user?.display_name ?? fallback;

  return (
    <ScrollView
      className="flex-1 bg-ink-950"
      contentContainerClassName="px-4 pb-12 pt-4"
      refreshControl={
        <RefreshControl refreshing={balances.refreshing} onRefresh={refresh} tintColor={colors.lotus['500']} />
      }
    >
      <Card className="mb-5 items-center py-6">
        <Text className="text-2xs uppercase tracking-widest text-ink-600">Your net position</Text>
        <Text
          className={`mt-1 text-4xl font-bold ${
            settlement.myBalanceAgorot > 0
              ? 'text-owed'
              : settlement.myBalanceAgorot < 0
                ? 'text-owing'
                : 'text-white'
          }`}
        >
          {settlement.myBalanceAgorot === 0
            ? 'All square'
            : formatAgorot(settlement.myBalanceAgorot, { sign: true })}
        </Text>
      </Card>

      {(balances.error || actionError) && (
        <ErrorNotice message={actionError ?? balances.error ?? ''} />
      )}

      <SectionTitle>Suggested payments</SectionTitle>
      {settlement.transactions.length === 0 ? (
        <View className="mb-6 rounded-3xl border border-dashed border-ink-700 bg-ink-900/40">
          <EmptyState
            emoji="🤝"
            title="Everyone's square"
            body="No outstanding balances in this group. Resolve a bet and they'll show up here."
          />
        </View>
      ) : (
        <View className="mb-6">
          <Text className="mb-3 text-xs leading-5 text-ink-600">
            The shortest set of payments that clears every balance. Pay each other however you
            normally do — cash, Bit, bank transfer — then tick it off here.
          </Text>

          {settlement.transactions.map((txn) => {
            const key = transactionKey(txn);
            const fromName = txn.fromUser?.display_name ?? nameOf(txn.fromUserId);
            const toName = txn.toUser?.display_name ?? nameOf(txn.toUserId);
            const involvesMe = txn.fromUserId === userId || txn.toUserId === userId;

            return (
              <Card key={key} className={`mb-2 ${involvesMe ? 'border-lotus-500/40' : ''}`}>
                <View className="flex-row items-center gap-3">
                  <Avatar name={fromName} size={30} />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-white">
                      {txn.fromUserId === userId ? 'You owe' : `${fromName} owes`}{' '}
                      {txn.toUserId === userId ? 'you' : toName}
                    </Text>
                    <Text className="text-lg font-bold text-lotus-400">
                      {formatAgorot(txn.amountAgorot)}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() =>
                      confirmMarkPaid({
                        fromUserId: txn.fromUserId,
                        toUserId: txn.toUserId,
                        amountAgorot: txn.amountAgorot,
                        fromName,
                        toName,
                      })
                    }
                    disabled={!involvesMe || pendingKey === key}
                    accessibilityRole="button"
                    className={`rounded-full border px-3 py-2 ${
                      involvesMe ? 'border-lotus-500 active:bg-lotus-500/15' : 'border-ink-700 opacity-40'
                    }`}
                  >
                    <Text className={`text-xs font-semibold ${involvesMe ? 'text-lotus-400' : 'text-ink-600'}`}>
                      {pendingKey === key ? 'Saving…' : 'Mark as paid'}
                    </Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <SectionTitle>Everyone&apos;s balance</SectionTitle>
      <Card>
        {settlement.balances.map((balance) => (
          <View
            key={balance.userId}
            className="flex-row items-center gap-3 border-b border-ink-800 py-2.5"
          >
            <Avatar name={balance.user?.display_name ?? '?'} size={30} />
            <Text className="flex-1 text-sm text-white">
              {balance.user?.display_name ?? 'Unknown'}
              {balance.userId === userId && <Text className="text-ink-600"> (you)</Text>}
            </Text>
            <Text
              className={`text-sm font-bold ${
                balance.amountAgorot > 0
                  ? 'text-owed'
                  : balance.amountAgorot < 0
                    ? 'text-owing'
                    : 'text-ink-600'
              }`}
            >
              {balance.amountAgorot === 0 ? '—' : formatAgorot(balance.amountAgorot, { sign: true })}
            </Text>
          </View>
        ))}
      </Card>

      <Text className="mt-6 text-center text-2xs leading-4 text-ink-600">
        Lotus Bet never moves money. Marking a payment as paid only updates the running total here.
      </Text>
    </ScrollView>
  );
}
