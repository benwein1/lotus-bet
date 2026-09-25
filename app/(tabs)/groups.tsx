import { LinearGradient } from 'expo-linear-gradient';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupFace } from '@/components/group-face';
import { AppMark } from '@/components/app-mark';
import { GroupsIcon, KeyIcon, SwordsIcon } from '@/components/icons';
import { RampRing } from '@/components/ramp-ring';
import { ContentWidth, Screen } from '@/components/screen';
import { GroupListSkeleton } from '@/components/skeletons';
import {
  AvatarStack,
  ErrorNotice,
  Money,
  PressableScale,
  SectionTitle,
  selectionTap,
} from '@/components/ui';
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
  // Where the ring actually is on screen, measured when it is pressed. The
  // menu hangs off this rather than off the top of the window, so the button
  // stays put and the card opens underneath it — which is what makes the two
  // read as one control rather than as a screen that jumped.
  const ringRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const groups = useAsync(fetchMyGroups, [userId]);
  const { reload: reloadGroups } = groups;

  // Reload on focus so a group created in the modal appears straight away.
  useFocusEffect(
    useCallback(() => {
      void reloadGroups({ silent: true });
    }, [reloadGroups])
  );

  const all = groups.data ?? [];
  // Two lists off one read. A duel *is* a group — same table, same policies,
  // same balances — so it needs no second query, only its own heading: "Flat
  // 4B" and "you versus Dor" are different kinds of thing to scan for.
  const rooms = all.filter((group) => group.kind !== 'duel');
  const duels = all.filter((group) => group.kind === 'duel');

  const go = (path: '/group/create' | '/challenge' | '/group/join') => {
    setAnchor(null);
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
            <View className="mb-[26px] flex-row items-end justify-between pt-3">
              <View className="flex-1 pr-4">
                <AppMark size={26} />
                <Text className="mt-3 text-[30px] font-semibold leading-[34px] tracking-[-0.9px] text-primary">
                  Groups & challenges
                </Text>
                <Text className="mt-1.5 text-sm text-secondary">
                  {describeList(rooms.length, duels.length)}
                </Text>
              </View>
              <View ref={ringRef} collapsable={false}>
                <RampRing
                  label="Create something"
                  onPress={() => {
                    selectionTap();
                    ringRef.current?.measureInWindow((x, y, width, height) =>
                      setAnchor({ x, y, width, height })
                    );
                  }}
                />
              </View>
            </View>

            {groups.error && <ErrorNotice message={groups.error} />}

            {groups.loading ? (
              <GroupListSkeleton />
            ) : all.length === 0 ? (
              <FirstRun />
            ) : (
              <>
                {rooms.map((group, i) => (
                  <GroupRow key={group.id} group={group} currentUserId={userId} index={i} />
                ))}

                {duels.length > 0 && (
                  <View className={rooms.length > 0 ? 'mt-4' : ''}>
                    <SectionTitle>Challenges</SectionTitle>
                    {duels.map((group, i) => (
                      <GroupRow
                        key={group.id}
                        group={group}
                        currentUserId={userId}
                        index={rooms.length + i}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>

      <CreateMenu anchor={anchor} onClose={() => setAnchor(null)} onPick={go} />
    </Screen>
  );
}

/**
 * The line under the title, which now has to cover two kinds of thing.
 *
 * Written out rather than assembled from fragments: "1 rooms and 2 challenges"
 * is the shape that comes of building a sentence out of counts, and the tab is
 * the first thing anyone opens after the feed.
 */
function describeList(rooms: number, duels: number): string {
  if (rooms === 0 && duels === 0) return 'The people you bet against live here.';
  if (rooms === 0) {
    return duels === 1 ? 'One challenge, just the two of you.' : `${duels} challenges, one on one.`;
  }
  if (duels === 0) {
    return rooms === 1 ? 'One room, and whoever is in it.' : `${rooms} rooms, and whoever is in them.`;
  }
  const roomWord = rooms === 1 ? '1 room' : `${rooms} rooms`;
  const duelWord = duels === 1 ? '1 challenge' : `${duels} challenges`;
  return `${roomWord} and ${duelWord}.`;
}

/** Where the ring sits on screen, in window coordinates. */
interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The three things the ring makes, as three names.
 *
 * Each row used to carry a line of explanation underneath it. They are gone:
 * without the descriptions every row is the same height, so the menu reads as
 * three equal choices instead of a list of justifications.
 *
 * **It hangs off the ring, not off the window.** The menu used to lay itself
 * out from the top of the screen with its own copy of the ring above it, so
 * opening it moved the button — the one thing that must not move, because the
 * button is what the menu belongs to. It is now placed from the ring's
 * measured rect, and the rotated ring is drawn at exactly that rect, so the
 * plus turns into a close where it already was and the card unrolls beneath
 * it.
 */
function CreateMenu({
  anchor,
  onClose,
  onPick,
}: {
  /** Null while closed: there is nothing to hang the menu off yet. */
  anchor: Anchor | null;
  onClose: () => void;
  onPick: (path: '/group/create' | '/challenge' | '/group/join') => void;
}) {
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const items = [
    { label: 'New group', Icon: GroupsIcon, path: '/group/create' as const },
    { label: 'Challenge one person', Icon: SwordsIcon, path: '/challenge' as const },
    { label: 'Join with a code', Icon: KeyIcon, path: '/group/join' as const },
  ];

  return (
    <Modal
      visible={anchor !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-scrim" onPress={onClose} accessibilityLabel="Close">
        {anchor && (
          <>
            {/* The same button, in the same place, now a close. */}
            <View style={{ position: 'absolute', left: anchor.x, top: anchor.y }}>
              <RampRing label="Close" rotated onPress={onClose} />
            </View>

            {/* Right-aligned to the ring, so the card and the button share an
                edge however wide the screen is. */}
            <View
              style={{
                position: 'absolute',
                top: anchor.y + anchor.height + 10,
                right: Math.max(0, windowWidth - (anchor.x + anchor.width)),
              }}
              // 236, not the board's 206: "Challenge one person" ellipsised at 206, and
              // a menu that truncates one of three choices is worse than a
              // slightly wider card.
              className="w-[236px] overflow-hidden rounded-3xl border border-hairline-strong bg-surface2"
            >
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
          </>
        )}
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

  // The board's row says how much is running here. `live_bet_count` is a
  // column on the group when the project has it; without it the line simply
  // reads the headcount, which is what it did before.
  const live = Number((group as { live_bet_count?: number }).live_bet_count ?? 0);

  const members = group.members.map((m) => ({
    id: m.user_id,
    name: m.user?.display_name ?? '?',
    avatarUrl: m.user?.avatar_url ?? null,
  }));

  // A duel's stored name is "You v Them", which reads as a stutter in a list
  // you are already in. The row is about the other person, so it says their
  // name and wears their face.
  const duel = group.kind === 'duel';
  const opponent = duel ? group.members.find((m) => m.user_id !== currentUserId)?.user : null;
  const title = opponent?.display_name ?? group.name;
  const faceUrl = duel ? (opponent?.avatar_url ?? null) : group.avatar_url;

  return (
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : FadeInDown.delay(Math.min(index, 6) * motion.stagger).duration(motion.duration.base)
      }
      className="mb-2.5 flex-row items-center gap-[13px] overflow-hidden rounded-2xl border border-hairline bg-surface py-[15px] pl-[19px] pr-4"
    >
      <LinearGradient
        colors={[colors.markFrom, colors.markTo]}
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
        {/* A square, photo or not. The placeholder used to be a huddle of
            member avatars inside a rounded box, which read as a crowd rather
            than as the group's own face — and made every row look different
            depending on how many people were in it. */}
        <GroupFace avatarUrl={faceUrl} size={48} radius={14} round={duel} />
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
            <Text
              numberOfLines={1}
              className="text-base font-semibold tracking-[-0.4px] text-primary"
            >
              {title}
            </Text>
            {/* Who is in it, as faces rather than as a count. The names are
                the group; "6 people" is a number about it. */}
            <View className="mt-1.5 flex-row items-center gap-2">
              {duel ? (
                // Two faces, one of them yours, says less than the word does.
                <Text numberOfLines={1} className="text-xs text-secondary">
                  {opponent?.username ? `@${opponent.username}` : 'Just the two of you'}
                </Text>
              ) : (
                <AvatarStack people={members} size={20} max={5} />
              )}
              {live > 0 && (
                <Text numberOfLines={1} className="text-xs text-secondary">
                  {live} live
                </Text>
              )}
            </View>
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

/**
 * One figure, no caption.
 *
 * The row already says everything else in words; a second line reading
 * "you're owed" under a green number is the colour saying it twice. The sign
 * carries the direction, which is the convention the ledger uses everywhere.
 */
function BalancePreview({
  balance,
  currency,
}: {
  balance: number | null;
  currency?: string | null;
}) {
  if (balance === null) return null;

  if (balance === 0) {
    return <Text className="text-base font-semibold text-secondary">Square</Text>;
  }

  return (
    <Money
      agorot={balance}
      currency={currency}
      size="sm"
      sign
      className="text-base font-bold tracking-[-0.3px]"
    />
  );
}
