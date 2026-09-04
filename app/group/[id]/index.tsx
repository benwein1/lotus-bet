import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetCard } from '@/components/bet-card';
import { CheckIcon, CopyIcon, HandshakeIcon, PlusIcon, TicketIcon } from '@/components/icons';
import { ContentWidth, ScreenBackdrop } from '@/components/screen';
import { BetFeedSkeleton } from '@/components/skeletons';
import {
  Avatar,
  Button,
  Card,
  EmptySlot,
  EmptyState,
  ErrorNotice,
  Loading,
  Overline,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { formatAgorot } from '@/lib/format';
import { fetchGroup, fetchGroupBalances, fetchGroupBets } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors, motion } from '@/theme';

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
    if (Platform.OS !== 'web') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (group.loading) return <Loading label="Loading group…" />;
  if (!group.data) {
    return (
      <View className="flex-1 bg-ink-950 px-gutter pt-10">
        <ErrorNotice message={group.error ?? 'This group is not available.'} />
      </View>
    );
  }

  const myBalance = Number(
    (balances.data ?? []).find((row) => row.user_id === userId)?.amount_agorot ?? 0
  );
  const allBets = bets.data ?? [];
  const openBets = allBets.filter((b) => b.status !== 'resolved' && b.status !== 'cancelled');
  const pastBets = allBets.filter((b) => b.status === 'resolved' || b.status === 'cancelled');

  const balanceTone =
    myBalance > 0 ? 'text-owed' : myBalance < 0 ? 'text-owing' : 'text-ink-50';

  return (
    <>
      <Stack.Screen options={{ title: group.data.name }} />
      <View className="flex-1 bg-ink-950">
        <ScreenBackdrop />
        <ScrollView
          contentContainerClassName="px-gutter pb-12 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={bets.refreshing}
              onRefresh={refresh}
              tintColor={colors.lotus['400']}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            {/* Identity + your position, the two things you open a group for */}
            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <Card level="raised" className="mb-4">
                <View className="flex-row items-center gap-4">
                  <View className="h-14 w-14 items-center justify-center rounded-2xl border border-ink-700 bg-ink-800">
                    <Text className="text-3xl">{group.data.emoji ?? '🎲'}</Text>
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={2} className="font-display text-lg leading-6 text-ink-50">
                      {group.data.name}
                    </Text>
                    <Text className="mt-0.5 text-xs text-ink-600">
                      {group.data.members.length}{' '}
                      {group.data.members.length === 1 ? 'member' : 'members'} ·{' '}
                      {allBets.length} {allBets.length === 1 ? 'bet' : 'bets'}
                    </Text>
                  </View>
                </View>

                <View className="mt-5 flex-row items-end justify-between border-t border-ink-750 pt-4">
                  <View>
                    <Overline>Your position here</Overline>
                    <Text className={`mt-1 font-display-bold text-3xl ${balanceTone}`}>
                      {myBalance === 0 ? 'All square' : formatAgorot(myBalance, { sign: true })}
                    </Text>
                  </View>
                  <Button
                    title="Settle up"
                    variant="secondary"
                    size="sm"
                    icon={<HandshakeIcon size={15} color={colors.ink['50']} />}
                    onPress={() =>
                      router.push({ pathname: '/group/[id]/settle', params: { id: groupId } })
                    }
                  />
                </View>
              </Card>
            </Animated.View>

            {/* Members + invite */}
            <Animated.View entering={FadeInDown.delay(60).duration(motion.duration.base)}>
              <SectionTitle>Members</SectionTitle>
              <Card className="mb-4" padded={false}>
                <View className="px-5 pt-4">
                  {group.data.members.map((member, i) => (
                    <View
                      key={member.user_id}
                      className={`flex-row items-center gap-3 py-2.5 ${
                        i === group.data!.members.length - 1 ? '' : 'border-b border-ink-800'
                      }`}
                    >
                      <Avatar
                        name={member.user?.display_name ?? '?'}
                        id={member.user_id}
                        size={34}
                      />
                      <Text className="flex-1 text-sm text-ink-50">
                        {member.user?.display_name ?? 'Unknown'}
                        {member.user_id === userId && (
                          <Text className="text-ink-600"> · you</Text>
                        )}
                      </Text>
                      {member.role === 'admin' && (
                        <Text className="font-display text-2xs uppercase tracking-[0.8px] text-ink-600">
                          admin
                        </Text>
                      )}
                    </View>
                  ))}
                </View>

                <View className="p-4">
                  <PressableScale
                    onPress={copyInvite}
                    scaleTo={0.985}
                    accessibilityRole="button"
                    accessibilityLabel="Copy invite code"
                    className="flex-row items-center justify-between rounded-2xl border border-dashed border-ink-700 bg-ink-1000 px-4 py-3.5"
                  >
                    <View>
                      <Overline>Invite code</Overline>
                      <Text className="mt-0.5 font-display-bold text-xl tracking-[3px] text-ink-50">
                        {group.data.invite_code}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      {copied ? (
                        <CheckIcon size={16} color={colors.sideA.DEFAULT} />
                      ) : (
                        <CopyIcon size={16} color={colors.lotus['300']} />
                      )}
                      <Text
                        className={`font-display text-sm ${
                          copied ? 'text-sideA' : 'text-lotus-300'
                        }`}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </Text>
                    </View>
                  </PressableScale>
                </View>
              </Card>
            </Animated.View>

            <Animated.View entering={FadeIn.delay(120).duration(motion.duration.base)}>
              <Button
                title="New bet"
                icon={<PlusIcon size={18} color="#fff" />}
                onPress={() =>
                  router.push({ pathname: '/group/[id]/new-bet', params: { id: groupId } })
                }
                className="mb-7"
              />
            </Animated.View>

            {bets.error && <ErrorNotice message={bets.error} />}

            <SectionTitle>Live bets</SectionTitle>
            {bets.loading ? (
              <BetFeedSkeleton count={2} />
            ) : openBets.length === 0 ? (
              <View className="mb-section">
                <EmptySlot>
                  <EmptyState
                    icon={<TicketIcon size={22} color={colors.lotus['400']} />}
                    title="Nothing running"
                    body="Start the first bet — pick a question with exactly two answers."
                  />
                </EmptySlot>
              </View>
            ) : (
              <View className="mb-section">
                {openBets.map((bet, i) => (
                  <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                ))}
              </View>
            )}

            {pastBets.length > 0 && (
              <>
                <SectionTitle>Settled &amp; cancelled</SectionTitle>
                {pastBets.map((bet, i) => (
                  <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                ))}
              </>
            )}
          </ContentWidth>
        </ScrollView>
      </View>
    </>
  );
}
