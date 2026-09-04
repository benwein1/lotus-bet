import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { BetCard } from '@/components/bet-card';
import { Avatar, Button, Card, EmptyState, ErrorNotice, Loading, SectionTitle } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { formatAgorot } from '@/lib/format';
import { fetchGroup, fetchGroupBalances, fetchGroupBets } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const group = useAsync(() => fetchGroup(groupId), [groupId]);
  const bets = useAsync(() => fetchGroupBets(groupId), [groupId]);
  const balances = useAsync(() => fetchGroupBalances(groupId), [groupId]);

  // Depend on the `reload` functions, not the state objects: `useAsync`
  // returns a new object every render, which would make `refresh` — and so the
  // Realtime subscription that keys off it — unstable.
  const { reload: reloadBets } = bets;
  const { reload: reloadBalances } = balances;
  const { reload: reloadGroup } = group;

  const refresh = useCallback(() => {
    void reloadBets({ silent: true });
    void reloadBalances({ silent: true });
    void reloadGroup({ silent: true });
  }, [reloadBets, reloadBalances, reloadGroup]);

  useGroupRealtime(groupId, refresh);

  const [copied, setCopied] = useState(false);

  async function copyInvite() {
    if (!group.data) return;
    await Clipboard.setStringAsync(group.data.invite_code);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (group.loading) return <Loading label="Loading group…" />;
  if (!group.data) {
    return (
      <View className="flex-1 bg-ink-950 pt-10">
        <ErrorNotice message={group.error ?? 'This group is not available.'} />
      </View>
    );
  }

  const myBalance = Number(
    (balances.data ?? []).find((row) => row.user_id === userId)?.amount_agorot ?? 0
  );
  const openBets = (bets.data ?? []).filter((bet) => bet.status !== 'resolved' && bet.status !== 'cancelled');
  const pastBets = (bets.data ?? []).filter((bet) => bet.status === 'resolved' || bet.status === 'cancelled');

  return (
    <>
      <Stack.Screen
        options={{ title: `${group.data.emoji ?? '🎲'} ${group.data.name}` }}
      />
      <ScrollView
        className="flex-1 bg-ink-950"
        contentContainerClassName="px-4 pb-12 pt-4"
        refreshControl={
          <RefreshControl refreshing={bets.refreshing} onRefresh={refresh} tintColor={colors.lotus['500']} />
        }
      >
        {/* Balance + settle up entry point */}
        <Card className="mb-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-2xs uppercase tracking-widest text-ink-600">
                Your position here
              </Text>
              <Text
                className={`mt-1 text-2xl font-bold ${
                  myBalance > 0 ? 'text-owed' : myBalance < 0 ? 'text-owing' : 'text-white'
                }`}
              >
                {myBalance === 0 ? 'All square' : formatAgorot(myBalance, { sign: true })}
              </Text>
            </View>
            <Link href={{ pathname: '/group/[id]/settle', params: { id: groupId } }} asChild>
              <Button title="Settle up" variant="secondary" />
            </Link>
          </View>
        </Card>

        {/* Members + invite code */}
        <SectionTitle>Members</SectionTitle>
        <Card className="mb-4">
          {group.data.members.map((member) => (
            <View key={member.user_id} className="flex-row items-center gap-3 py-1.5">
              <Avatar name={member.user?.display_name ?? '?'} size={32} />
              <Text className="flex-1 text-sm text-white">
                {member.user?.display_name ?? 'Unknown'}
                {member.user_id === userId && (
                  <Text className="text-ink-600"> (you)</Text>
                )}
              </Text>
              {member.role === 'admin' && (
                <Text className="text-2xs uppercase tracking-wider text-ink-600">admin</Text>
              )}
            </View>
          ))}

          <Pressable
            onPress={copyInvite}
            className="mt-3 flex-row items-center justify-between rounded-2xl border border-dashed border-ink-700 px-4 py-3 active:bg-ink-800"
          >
            <View>
              <Text className="text-2xs uppercase tracking-widest text-ink-600">Invite code</Text>
              <Text className="text-lg font-bold tracking-[4px] text-white">
                {group.data.invite_code}
              </Text>
            </View>
            <Text className="text-sm text-lotus-400">{copied ? 'Copied ✓' : 'Copy'}</Text>
          </Pressable>
        </Card>

        <Button
          title="+ New bet"
          onPress={() => router.push({ pathname: '/group/[id]/new-bet', params: { id: groupId } })}
          className="mb-6"
        />

        {bets.error && <ErrorNotice message={bets.error} />}

        <SectionTitle>Live bets</SectionTitle>
        {openBets.length === 0 ? (
          <View className="mb-6 rounded-3xl border border-dashed border-ink-700 bg-ink-900/40">
            <EmptyState
              emoji="🎲"
              title="Nothing running"
              body="Start the first bet — pick a question with exactly two answers."
            />
          </View>
        ) : (
          <View className="mb-6">
            {openBets.map((bet) => (
              <BetCard key={bet.id} bet={bet} currentUserId={userId} />
            ))}
          </View>
        )}

        {pastBets.length > 0 && (
          <>
            <SectionTitle>Settled &amp; cancelled</SectionTitle>
            {pastBets.map((bet) => (
              <BetCard key={bet.id} bet={bet} currentUserId={userId} />
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}
