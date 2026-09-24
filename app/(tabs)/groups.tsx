import { LinearGradient } from 'expo-linear-gradient';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupFace } from '@/components/group-face';
import { AppMark } from '@/components/app-mark';
import { GroupsIcon, KeyIcon, SwordsIcon } from '@/components/icons';
import { RampRing } from '@/components/ramp-ring';
import { ContentWidth, Screen } from '@/components/screen';
import { GroupListSkeleton } from '@/components/skeletons';
import { ErrorNotice, Money, PressableScale, selectionTap } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { fetchGroupBalances, fetchMyGroups, type GroupWithMembers } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

/**
 * The Groups tab.
 *
 * One list and one button. The three actions that used to sit above the list
 * as buttons — new group, join with a code, challenge one person — are all
 * things you *make*, so they live behind the one ring in the header instead of
 * taking a third of the screen before the first group.
 *
 * Each row carries the group's face on the left as its own control: pressing
 * the face opens the group's profile, pressing the row opens the group. They
 * are siblings rather than nested, because a pressable inside a `Link` fires
 * both the press and the browser's own navigation on the web.
 */
export default function GroupsScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const tabInset = useTabBarInset();
  const [menuOpen, setMenuOpen] = useState(false);

  const groups = useAsync(fetchMyGroups, [userId]);
  const { reload: reloadGroups } = groups;

  // Reload on focus so a group created in the modal appears straight away.
  useFocusEffect(
    useCallback(() => {
      void reloadGroups({ silent: true });
    }, [reloadGroups])
  );

  const list = groups.data ?? [];
  const live = list.length;

  const go = (path: '/group/create' | '/challenge' | '/group/join') => {
    setMenuOpen(false);
    router.push(path);
  };

  return (
    <Screen>
      <SafeAreaView edges={['top']} className="flex-1">
        <ScrollView
          contentContainerStyle={{ paddingBottom: tabInset }}
          contentContainerClassName="px-6 pt-2"
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
            <View className="mb-7 flex-row items-end justify-between pt-3">
              <View className="flex-1 pr-4">
                <AppMark size={26} />
                <Text className="mt-3 text-3xl font-semibold tracking-tight text-primary">
                  Your groups
                </Text>
                <Text className="mt-1.5 text-subhead text-secondary">
                  {live === 0
                    ? 'The people you bet against live here.'
                    : live === 1
                      ? 'One room, and whoever is in it.'
                      : `${live} rooms, and whoever is in them.`}
                </Text>
              </View>
              <RampRing
                label="Create something"
                onPress={() => {
                  selectionTap();
                  setMenuOpen(true);
                }}
              />
            </View>

            {groups.error && <ErrorNotice message={groups.error} />}

            {groups.loading ? (
              <GroupListSkeleton />
            ) : list.length === 0 ? (
              <FirstRun />
            ) : (
              list.map((group, i) => (
                <GroupRow key={group.id} group={group} currentUserId={userId} index={i} />
              ))
            )}
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>

      <CreateMenu open={menuOpen} onClose={() => setMenuOpen(false)} onPick={go} />
    </Screen>
  );
}

/**
 * The three things the ring makes, as three names.
 *
 * Each row used to carry a line of explanation underneath it. They are gone:
 * with the descriptions removed the card sits at 206 rather than 262 wide and
 * every row is the same height, so the menu reads as three equal choices
 * instead of a list of justifications.
 */
function CreateMenu({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (path: '/group/create' | '/challenge' | '/group/join') => void;
}) {
  const colors = useColors();
  const items = [
    { label: 'New group', Icon: GroupsIcon, path: '/group/create' as const },
    { label: 'Challenge one person', Icon: SwordsIcon, path: '/challenge' as const },
    { label: 'Join with a code', Icon: KeyIcon, path: '/group/join' as const },
  ];

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim" onPress={onClose} accessibilityLabel="Close">
        <SafeAreaView edges={['top']} className="flex-1">
          <View className="items-end px-6 pt-3">
            <RampRing label="Close" rotated onPress={onClose} />
            <View className="mt-3 w-[206px] overflow-hidden rounded-3xl border border-hairline-strong bg-surface2">
              {items.map((item, i) => (
                <PressableScale
                  key={item.label}
                  accessibilityRole="button"
                  onPress={() => onPick(item.path)}
                  className={`h-[52px] flex-row items-center gap-3 px-4 ${
                    i < items.length - 1 ? 'border-b border-hairline' : ''
                  }`}
                >
                  <View className="h-[30px] w-[30px] items-center justify-center rounded-xl bg-surface3">
                    <item.Icon size={17} color={colors.accent} />
                  </View>
                  <Text
                    numberOfLines={1}
                    className="flex-1 text-subhead font-semibold text-primary"
                  >
                    {item.label}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

/**
 * One group. The left edge carries the mark's ramp so a row belongs to this
 * app at a glance, and the face beside it is the way in to the group profile.
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
  const router = useRouter();
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
      className="mb-2.5 flex-row items-center gap-3 overflow-hidden rounded-2xl border border-hairline bg-surface py-3 pl-[19px] pr-4"
    >
      <LinearGradient
        colors={[colors.markTo, colors.markFrom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 }}
      />

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${group.name} — group profile`}
        // The group's people are its profile: the face opens the group on its
        // People tab rather than on a second screen that says the same thing.
        onPress={() =>
          router.push({ pathname: '/group/[id]', params: { id: group.id, tab: 'people' } })
        }
      >
        <GroupFace avatarUrl={group.avatar_url} members={members} />
      </PressableScale>

      <Link
        href={{ pathname: '/group/[id]', params: { id: group.id } }}
        asChild
        className="flex-1"
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Group: ${group.name}`}
          className="flex-1 flex-row items-center gap-3"
        >
          <View className="flex-1">
            <Text numberOfLines={1} className="text-base font-semibold text-primary">
              {group.name}
            </Text>
            <Text numberOfLines={1} className="mt-1 text-xs text-secondary">
              {group.members.length === 1 ? '1 person' : `${group.members.length} people`}
            </Text>
          </View>
          <BalancePreview balance={balance} currency={group.currency} />
        </PressableScale>
      </Link>
    </Animated.View>
  );
}

/** A first-run screen, not a null state: this says what a group is for. */
function FirstRun() {
  const colors = useColors();

  return (
    <View className="mt-2 rounded-3xl border border-hairline-strong bg-surface p-6">
      <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft">
        <GroupsIcon size={26} color={colors.accent} />
      </View>
      <Text className="text-xl font-bold text-primary">Start with a group</Text>
      <Text className="mt-2 text-callout leading-5 text-secondary">
        A group is the people you bet against — a football chat, your flat, the five of you who
        argue about everything. Bets only ever go to a group you are in.
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
          body="Betta keeps the running total. No money goes through the app."
        />
      </View>
    </View>
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

function BalancePreview({
  balance,
  currency,
}: {
  balance: number | null;
  currency?: string | null;
}) {
  if (balance === null) return null;

  if (balance === 0) {
    return <Text className="text-callout font-semibold text-secondary">Square</Text>;
  }

  return (
    <View className="items-end">
      <Money agorot={Math.abs(balance)} currency={currency} size="sm" sign={false} tone={balance > 0 ? 'positive' : 'negative'} />
      <Text className="mt-0.5 text-2xs text-tertiary">{balance > 0 ? "you're owed" : 'you owe'}</Text>
    </View>
  );
}
