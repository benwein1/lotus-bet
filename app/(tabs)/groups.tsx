import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { AvatarStack, Button, Card, EmptyState, ErrorNotice, Loading } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { formatAgorot } from '@/lib/format';
import { fetchGroupBalances, fetchMyGroups, type GroupWithMembers } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function GroupsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const groups = useAsync(fetchMyGroups, [userId]);

  // Reload on focus so a group created in the modal appears straight away.
  useFocusEffect(
    useCallback(() => {
      void groups.reload({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (groups.loading) return <Loading label="Loading your groups…" />;

  const list = groups.data ?? [];

  return (
    <ScrollView
      className="flex-1 bg-ink-950"
      contentContainerClassName="px-4 pb-10 pt-4"
      refreshControl={
        <RefreshControl
          refreshing={groups.refreshing}
          onRefresh={() => groups.reload()}
          tintColor={colors.lotus['500']}
        />
      }
    >
      {groups.error && <ErrorNotice message={groups.error} />}

      <View className="mb-5 flex-row gap-3">
        <Link href="/group/create" asChild>
          <Button title="+ Create group" className="flex-1" />
        </Link>
        <Link href="/group/join" asChild>
          <Button title="Join" variant="secondary" className="flex-1" />
        </Link>
      </View>

      {list.length === 0 ? (
        <EmptyState
          emoji="👋"
          title="No groups yet"
          body="Create one for your football chat, your flatmates, whoever — then share the invite code."
        />
      ) : (
        list.map((group) => (
          <GroupRow key={group.id} group={group} currentUserId={userId} />
        ))
      )}
    </ScrollView>
  );
}

/**
 * One row per group with a live "you're owed / you owe" preview. The balance is
 * a separate cheap RPC per group rather than one big join, which keeps the RLS
 * story simple and the list snappy for the handful of groups an MVP user has.
 */
function GroupRow({ group, currentUserId }: { group: GroupWithMembers; currentUserId: string }) {
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

  const memberNames = group.members.map((m) => m.user?.display_name ?? '?');

  return (
    <Link href={{ pathname: '/group/[id]', params: { id: group.id } }} asChild>
      <Pressable>
        <Card className="mb-3 active:bg-ink-800">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-ink-800">
              <Text className="text-2xl">{group.emoji ?? '🎲'}</Text>
            </View>

            <View className="flex-1">
              <Text numberOfLines={1} className="text-base font-semibold text-white">
                {group.name}
              </Text>
              <Text className="text-xs text-ink-600">
                {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
              </Text>
            </View>

            <View className="items-end">
              <BalancePreview balance={balance} />
            </View>
          </View>

          <View className="mt-3">
            <AvatarStack names={memberNames} />
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

function BalancePreview({ balance }: { balance: number | null }) {
  if (balance === null) return <Text className="text-xs text-ink-600">—</Text>;
  if (balance === 0) return <Text className="text-xs text-ink-600">All square</Text>;

  const owed = balance > 0;
  return (
    <>
      <Text className={`text-base font-bold ${owed ? 'text-owed' : 'text-owing'}`}>
        {formatAgorot(Math.abs(balance))}
      </Text>
      <Text className="text-2xs uppercase tracking-wider text-ink-600">
        {owed ? "you're owed" : 'you owe'}
      </Text>
    </>
  );
}
