import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupGlyph } from '@/components/group-glyph';
import { ChevronRightIcon, GroupsIcon, PlusIcon, SwordsIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { GroupListSkeleton } from '@/components/skeletons';
import {
  AvatarStack,
  Button,
  ErrorNotice,
  Money,
  PressableScale,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { fetchGroupBalances, fetchMyGroups, type GroupWithMembers } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { elevation, motion } from '@/theme';

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
            {/* No screen title: the tab bar says which tab this is, and the
                two things you came here to do sit at the top instead. */}
            <View className="pt-3" />

            {groups.error && <ErrorNotice message={groups.error} />}

            <View className="mb-6 flex-row gap-3 pt-4">
              <Button
                title="New group"
                size="lg"
                elevated
                className="flex-1"
                icon={<PlusIcon size={17} color={colors.accentInk} />}
                onPress={() => router.push('/group/create')}
              />
              <Button
                title="Join"
                variant="secondary"
                size="lg"
                className="flex-1"
                onPress={() => router.push('/group/join')}
              />
            </View>

            {/* Challenging one person is not a third kind of group, so it sits
                below the two group actions rather than beside them — and there
                is no card for it in the list, because a duel would otherwise
                turn this tab into a roster of everyone you have ever bet
                against. It surfaces in the feed and on your profile instead. */}
            <PressableScale
              onPress={() => router.push('/challenge')}
              accessibilityRole="button"
              accessibilityLabel="Challenge one person by username"
              className="mb-6 -mt-2 flex-row items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3"
            >
              <SwordsIcon size={20} color={colors.accent} />
              <View className="flex-1">
                <Text className="text-callout font-semibold text-primary">
                  Challenge one person
                </Text>
                <Text numberOfLines={1} className="text-sm text-secondary">
                  By username — no shared group needed
                </Text>
              </View>
              <ChevronRightIcon size={16} color={colors.textTertiary} />
            </PressableScale>

            {groups.loading ? (
              <GroupListSkeleton />
            ) : list.length === 0 ? (
              // A first-run screen, not a null state. Somebody here has never
              // seen the app work, so this says what it is for and what
              // happens next rather than reporting an absence.
              <View className="mt-2 rounded-3xl border border-hairline-strong bg-surface p-6">
                <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft">
                  <GroupsIcon size={26} color={colors.accent} />
                </View>
                <Text className="text-xl font-bold text-primary">Start with a group</Text>
                <Text className="mt-2 text-callout leading-5 text-secondary">
                  A group is the people you bet against — a football chat, your flat, the five
                  of you who argue about everything. Bets only ever go to a group you are in.
                </Text>

                <View className="mt-6 gap-3">
                  <HowItWorks
                    step="1"
                    title="Make a group and share the code"
                    body="Six characters. They tap Join and type it in."
                  />
                  <HowItWorks
                    step="2"
                    title="Post a bet with two sides"
                    body="Set one pot for the whole thing. It doesn't grow as people join."
                  />
                  <HowItWorks
                    step="3"
                    title="Call it, and settle up between yourselves"
                    body="Lotus Bet keeps the running total. No money goes through the app."
                  />
                </View>
              </View>
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
    avatarUrl: m.user?.avatar_url ?? null,
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
          // A hairline over `sunken` all but vanished in both schemes — white
          // on #F2F2F7, and #0E0E11 on black. The strong rule plus a shadow is
          // what makes one card read as a separate object from the next.
          style={elevation.card}
          className="mb-3 flex-row items-center gap-4 rounded-3xl border border-hairline-strong bg-surface p-4"
        >
          <GroupGlyph
            emoji={group.emoji}
            avatarUrl={group.avatar_url}
            name={group.name}
            size={48}
            radius={16}
          />

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

/** One numbered step of the first-run explainer. */
function HowItWorks({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <View className="flex-row gap-3">
      <View className="h-6 w-6 items-center justify-center rounded-full bg-surface3">
        <Text className="text-xs font-semibold text-secondary">{step}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-subhead font-semibold text-primary">{title}</Text>
        <Text className="mt-0.5 text-sm leading-[18px] text-secondary">{body}</Text>
      </View>
    </View>
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
