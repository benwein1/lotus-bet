import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChevronRightIcon, GroupsIcon, PlusIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
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
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { fetchGroupBalances, fetchMyGroups, type GroupWithMembers } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function GroupsScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const tabInset = useTabBarInset();

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
    <Screen ground="sunken">
      <SafeAreaView edges={['top']} className="flex-1">
        <ScrollView
          contentContainerStyle={{ paddingBottom: tabInset }}
          contentContainerClassName="px-gutter pt-2"
          refreshControl={
            <RefreshControl
              refreshing={groups.refreshing}
              onRefresh={() => groups.reload()}
              tintColor={colors.textTertiary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <View className="mb-6 pt-4">
              <Title>Groups</Title>
              {!groups.loading && list.length > 0 && (
                <Text className="mt-1.5 text-callout text-secondary">
                  {list.length} {list.length === 1 ? 'group' : 'groups'}, settled up outside the app.
                </Text>
              )}
            </View>

            {groups.error && <ErrorNotice message={groups.error} />}

            <View className="mb-6 flex-row gap-3">
              <Button
                title="New group"
                className="flex-1"
                icon={<PlusIcon size={17} color={colors.accentInk} />}
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
                icon={<GroupsIcon size={26} color={colors.textSecondary} />}
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
    </Screen>
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
  const colors = useColors();
  const reduced = useReducedMotion();
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
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : FadeInDown.delay(Math.min(index, 6) * motion.stagger).duration(motion.duration.base)
      }
    >
      <Link href={{ pathname: '/group/[id]', params: { id: group.id } }} asChild>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Group: ${group.name}`}
          className="mb-3 flex-row items-center gap-4 rounded-3xl border border-hairline bg-surface p-4"
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface2">
            <Text className="text-xl">{group.emoji ?? '🎲'}</Text>
          </View>

          <View className="flex-1">
            <Text numberOfLines={1} className="text-base font-semibold text-primary">
              {group.name}
            </Text>
            <View className="mt-2">
              <AvatarStack people={members} size={22} />
            </View>
          </View>

          <View className="items-end gap-1">
            <BalancePreview balance={balance} />
          </View>

          <ChevronRightIcon size={17} color={colors.textTertiary} />
        </PressableScale>
      </Link>
    </Animated.View>
  );
}

function BalancePreview({ balance }: { balance: number | null }) {
  if (balance === null) return null;

  if (balance === 0) {
    return (
      <>
        <Text className="text-callout font-semibold text-primary">Square</Text>
        <Text className="text-xs text-tertiary">nothing owed</Text>
      </>
    );
  }

  const owed = balance > 0;
  return (
    <>
      <Money agorot={Math.abs(balance)} size="md" tone={owed ? 'positive' : 'negative'} />
      <Text className="text-xs text-tertiary">{owed ? "you're owed" : 'you owe'}</Text>
    </>
  );
}
