import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupsIcon, PlusIcon, TicketIcon } from '@/components/icons';
import { ContentWidth, ScreenGround } from '@/components/screen';
import { GroupListSkeleton } from '@/components/skeletons';
import {
  AvatarStack,
  Button,
  EmptyState,
  ErrorNotice,
  Money,
  PressableScale,
  Title,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { fetchGroupBalances, fetchMyGroups, type GroupWithMembers } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors, motion } from '@/theme';

export default function GroupsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const router = useRouter();

  const groups = useAsync(fetchMyGroups, [userId]);
  const { reload: reloadGroups } = groups;

  // Reload on focus so a group created in the modal appears straight away.
  useFocusEffect(
    useCallback(() => {
      void reloadGroups({ silent: true });
    }, [reloadGroups])
  );

  const list = groups.data ?? [];

  return (
    <View className="flex-1 bg-ink-950">
      <ScreenGround />
      <SafeAreaView edges={['top']} className="flex-1">
        <ScrollView
          contentContainerClassName="px-gutter pb-10 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={groups.refreshing}
              onRefresh={() => groups.reload()}
              tintColor={colors.brass['400']}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <View className="mb-7 pt-6">
              <Title>Groups</Title>
              {!groups.loading && list.length > 0 && (
                <Text className="mt-3 text-sm text-ink-600">
                  {list.length} {list.length === 1 ? 'group' : 'groups'}, settled up outside the app.
                </Text>
              )}
            </View>

            {groups.error && <ErrorNotice message={groups.error} />}

            <View className="mb-7 flex-row gap-3">
              <Button
                title="New group"
                className="flex-1"
                icon={<PlusIcon size={17} color="#fff" />}
                onPress={() => router.push('/group/create')}
              />
              <Button
                title="Join"
                variant="secondary"
                className="flex-1"
                onPress={() => router.push('/group/join')}
              />
            </View>

            {groups.loading ? (
              <GroupListSkeleton />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<GroupsIcon size={26} color={colors.ink['500']} />}
                title="No groups yet"
                body="Create one for your football chat, your flatmates, whoever — then share the invite code."
              />
            ) : (
              list.map((group, i) => (
                <GroupRow key={group.id} group={group} currentUserId={userId} index={i} />
              ))
            )}
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * One row per group with a live "you're owed / you owe" preview. The balance is
 * a separate cheap RPC per group rather than one big join, which keeps the RLS
 * story simple and the list snappy for the handful of groups an MVP user has.
 */
function GroupRow({
  group,
  currentUserId,
  index,
}: {
  group: GroupWithMembers;
  currentUserId: string;
  index: number;
}) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchGroupBalances(group.id)
      .then((rows) => {
        if (!active) return;
        const mine = rows.find((row) => row.user_id === currentUserId);
        setBalance(Number(mine?.amount_agorot ?? 0));
      })
      .catch(() => {
        if (active) setBalance(null);
      });

    return () => {
      active = false;
    };
  }, [group.id, currentUserId]);

  const members = group.members.map((m) => ({
    id: m.user_id,
    name: m.user?.display_name ?? '?',
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * motion.stagger).duration(motion.duration.base)}>
      <Link href={{ pathname: '/group/[id]', params: { id: group.id } }} asChild>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Group: ${group.name}`}
          className="py-5"
        >
          <View className="h-px bg-ink-800" />
          <View className="mt-5 flex-row items-start gap-4">
            <Text className="text-2xl leading-7">{group.emoji ?? '🎲'}</Text>

            <View className="flex-1">
              <Text numberOfLines={1} className="font-display text-lg leading-6 text-ink-50">
                {group.name}
              </Text>
              <View className="mt-3">
                <AvatarStack people={members} size={24} />
              </View>
            </View>

            <View className="items-end">
              <BalancePreview balance={balance} />
            </View>
          </View>
        </PressableScale>
      </Link>
    </Animated.View>
  );
}

function BalancePreview({ balance }: { balance: number | null }) {
  if (balance === null) return <TicketIcon size={15} color={colors.ink['700']} />;

  if (balance === 0) {
    return (
      <>
        <Text className="font-display text-lg text-ink-500">Square</Text>
        <Text className="mt-0.5 text-xs text-ink-650">nothing owed</Text>
      </>
    );
  }

  const owed = balance > 0;
  return (
    <>
      <Money agorot={Math.abs(balance)} size="lg" tone={owed ? 'owed' : 'owing'} />
      <Text className="mt-0.5 text-xs text-ink-650">{owed ? "you're owed" : 'you owe'}</Text>
    </>
  );
}
