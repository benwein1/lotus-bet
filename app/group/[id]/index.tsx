import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetCard } from '@/components/bet-card';
import { CheckIcon, CopyIcon, HandshakeIcon, PlusIcon, TicketIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { BetCardSkeleton } from '@/components/skeletons';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorNotice,
  Loading,
  Money,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { fetchGroup, fetchGroupBalances, fetchGroupBets } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const router = useRouter();
  const { session } = useAuth();
  const colors = useColors();
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

  // This screen stays mounted underneath the new-bet and bet-detail screens
  // pushed on top of it, so without this a bet you just posted would be
  // missing from "Live bets" when you came back. Realtime carries other
  // people's changes; this carries your own.
  useFocusEffect(refresh);

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
      <Screen className="px-gutter pt-10">
        <ErrorNotice message={group.error ?? 'This group is not available.'} />
      </Screen>
    );
  }

  const myBalance = Number(
    (balances.data ?? []).find((row) => row.user_id === userId)?.amount_agorot ?? 0
  );
  const allBets = bets.data ?? [];
  const openBets = allBets.filter((b) => b.status !== 'resolved' && b.status !== 'cancelled');
  const pastBets = allBets.filter((b) => b.status === 'resolved' || b.status === 'cancelled');

  return (
    <>
      <Stack.Screen options={{ title: group.data.name }} />
      <Screen ground="sunken">
        <ScrollView
          contentContainerClassName="px-gutter pb-12 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={bets.refreshing}
              onRefresh={refresh}
              tintColor={colors.textTertiary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            {/* Identity + your position, the two things you open a group for */}
            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <View className="mb-7 pt-4">
                <View className="flex-row items-start gap-3">
                  <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface2">
                    <Text className="text-xl">{group.data.emoji ?? '🎲'}</Text>
                  </View>
                  <View className="flex-1">
                    <Text numberOfLines={2} className="text-2xl font-bold text-primary">
                      {group.data.name}
                    </Text>
                    <Text className="mt-1 text-subhead text-secondary">
                      {group.data.members.length}{' '}
                      {group.data.members.length === 1 ? 'member' : 'members'}, {allBets.length}{' '}
                      {allBets.length === 1 ? 'bet' : 'bets'}
                    </Text>
                  </View>
                </View>

                <View className="mt-5 flex-row items-end justify-between rounded-3xl border border-hairline bg-surface p-4">
                  <View>
                    <Text className="text-sm text-secondary">Your position here</Text>
                    <View className="mt-1">
                      {myBalance === 0 ? (
                        <Text className="text-2xl font-bold text-primary">Square</Text>
                      ) : (
                        <Money agorot={myBalance} size="lg" sign />
                      )}
                    </View>
                  </View>
                  <Button
                    title="Settle up"
                    variant="tinted"
                    size="sm"
                    icon={<HandshakeIcon size={15} color={colors.accent} />}
                    onPress={() =>
                      router.push({ pathname: '/group/[id]/settle', params: { id: groupId } })
                    }
                  />
                </View>
              </View>
            </Animated.View>

            {/* Members + invite */}
            <Animated.View entering={FadeInDown.delay(60).duration(motion.duration.base)}>
              <View className="mb-7">
                <SectionTitle>Members</SectionTitle>
                <View className="overflow-hidden rounded-3xl border border-hairline bg-surface px-4">
                  {group.data.members.map((member, i) => (
                    <View
                      key={member.user_id}
                      className={`flex-row items-center gap-3 py-3 ${
                        i === group.data!.members.length - 1 ? '' : 'border-b border-hairline'
                      }`}
                    >
                      <Avatar
                        name={member.user?.display_name ?? '?'}
                        id={member.user_id}
                        size={34}
                      />
                      <Text className="flex-1 text-base text-primary">
                        {member.user?.display_name ?? 'Unknown'}
                        {member.user_id === userId && (
                          <Text className="text-secondary"> (you)</Text>
                        )}
                      </Text>
                      {member.role === 'admin' && (
                        <Text className="text-sm text-secondary">Admin</Text>
                      )}
                    </View>
                  ))}
                </View>

                <View className="mt-3">
                  <PressableScale
                    onPress={copyInvite}
                    scaleTo={0.985}
                    accessibilityRole="button"
                    accessibilityLabel="Copy invite code"
                    className="flex-row items-center justify-between rounded-3xl border border-hairline bg-surface px-4 py-4"
                  >
                    <View>
                      <Text className="text-sm text-secondary">Invite code</Text>
                      <Text className="mt-0.5 text-xl font-bold tracking-[4px] text-primary">
                        {group.data.invite_code}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      {copied ? (
                        <CheckIcon size={16} color={colors.positive} />
                      ) : (
                        <CopyIcon size={16} color={colors.accent} />
                      )}
                      <Text
                        className={`text-subhead font-semibold ${
                          copied ? 'text-positive' : 'text-accent'
                        }`}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </Text>
                    </View>
                  </PressableScale>
                </View>
              </View>
            </Animated.View>

            <Animated.View entering={FadeIn.delay(120).duration(motion.duration.base)}>
              <Button
                title="New bet"
                icon={<PlusIcon size={18} color={colors.accentInk} />}
                onPress={() =>
                  router.push({ pathname: '/group/[id]/new-bet', params: { id: groupId } })
                }
                className="mb-7"
              />
            </Animated.View>

            {bets.error && <ErrorNotice message={bets.error} />}

            <View className="mb-7">
              <SectionTitle>Live bets</SectionTitle>
              {bets.loading ? (
                <>
                  <BetCardSkeleton />
                  <BetCardSkeleton />
                </>
              ) : openBets.length === 0 ? (
                <View className="rounded-3xl border border-hairline bg-surface">
                  <EmptyState
                    icon={<TicketIcon size={26} color={colors.textSecondary} />}
                    title="Nothing running"
                    body="Start the first bet — pick a question with exactly two answers."
                  />
                </View>
              ) : (
                <View>
                  {openBets.map((bet, i) => (
                    <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                  ))}
                </View>
              )}
            </View>

            {pastBets.length > 0 && (
              <View>
                <SectionTitle>Settled and cancelled</SectionTitle>
                {pastBets.map((bet, i) => (
                  <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                ))}
              </View>
            )}
          </ContentWidth>
        </ScrollView>
      </Screen>
    </>
  );
}
